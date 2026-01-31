#!/bin/bash

# db_backup.sh - Database backup and restore utility
# Usage:
#   ./db_backup.sh backup_localhost     - Backup localhost database
#   ./db_backup.sh backup_prd           - Backup production database
#   ./db_backup.sh prd_to_localhost     - Restore production backup to localhost

set -e  # Exit on error

# Configuration
BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Ensure backup directory exists
mkdir -p "$BACKUP_DIR"


# Function to load environment file
load_env() {
    local env_file="$1"

    if [ ! -f "$env_file" ]; then
        echo "Error: Environment file not found: $env_file"
        exit 1
    fi

    echo "Loading environment: $env_file" >&2
    source "$env_file"

    if [ -z "$DATABASE_URL" ]; then
        echo "Error: DATABASE_URL not set in $env_file"
        exit 1
    fi
}

# Function to backup localhost database
backup_localhost() {
    local backup_file="$BACKUP_DIR/backup_localhost_${TIMESTAMP}.sql"

    echo "Backing up localhost database..."

    # Load local environment
    load_env ".env.local"

    # Use DATABASE_URL from .env.local
    pg_dump "$DATABASE_URL" \
        --clean \
        --no-owner \
        --no-privileges \
        --schema=public \
        > "$backup_file"

    echo "Localhost backup saved to: $backup_file"
    echo "$backup_file"
}

# Function to backup production database
backup_production() {
    local backup_file="$BACKUP_DIR/backup_production_${TIMESTAMP}.sql"

    echo "Backing up production database..." >&2

    # Load production environment
    load_env ".env.production"

    # Use DATABASE_URL from .env.production
    # Only backup public schema to avoid PaaS-specific infrastructure
    pg_dump "$DATABASE_URL" \
        --clean \
        --if-exists \
        --no-owner \
        --no-privileges \
        --schema=public \
        > "$backup_file"

    echo "Production backup saved to: $backup_file" >&2
    echo "$backup_file"
}

# Function to restore backup to localhost
restore_to_localhost() {
    local backup_file="$1"

    echo "WARNING: This will REPLACE all data in localhost database!"

    # Load local environment to show which database
    load_env ".env.local"
    echo "Database: $DATABASE_URL"

    read -p "Are you sure you want to continue? (yes/no): " confirmation

    if [ "$confirmation" != "yes" ]; then
        echo "Restore cancelled"
        exit 0
    fi

    echo "🔄 Restoring backup to localhost..."

    # Restore and capture any unexpected errors
    local errors=$(psql "$DATABASE_URL" < "$backup_file" 2>&1 | \
        grep -i "error" | \
        grep -v "role \"postgres\" does not exist" | \
        grep -v "schema \"public\" already exists" | \
        grep -v "cannot drop schema public because other objects depend on it" || true)

    # If there are any real errors, show them and exit
    if [ -n "$errors" ]; then
        echo "Restore failed with errors:"
        echo "$errors"
        exit 1
    fi

    # Verify restore was successful
    echo "🔍 Verifying restore..."

    # If these 5 tables don't exist, there's probably a problem :)
    local table_count=$(psql "$DATABASE_URL" -t -c "
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name IN ('accounts', 'balance_snapshots', 'exchange_rates', 'plaid_items', 'users')
    " | xargs)

    if [ "$table_count" -eq "5" ]; then
        local record_count=$(psql "$DATABASE_URL" -t -c "SELECT COUNT(*) FROM balance_snapshots" | xargs)
        echo "Restore complete!${NC}"
        echo "   • 5/5 core tables present${NC}"
        echo "   • $record_count balance snapshots restored${NC}"
    else
        echo "Warning: Only $table_count/5 core tables found"
        echo "Expected: accounts, balance_snapshots, exchange_rates, plaid_items, users"
        exit 1
    fi
}

# Main script logic
case "$1" in
    backup_localhost)
        # echo "${BLUE}═══════════════════════════════════════${NC}"
        # echo "${BLUE}  Backup Localhost Database${NC}"
        # echo "${BLUE}═══════════════════════════════════════${NC}"
        echo "  Backup Localhost Database"
        backup_localhost
        ;;

    backup_prd)
        # echo "${BLUE}═══════════════════════════════════════${NC}"
        # echo "${BLUE}  Backup Production Database${NC}"
        # echo "${BLUE}═══════════════════════════════════════${NC}"
        echo "  Backing up Production Database"
        backup_production
        ;;

    prd_to_localhost)
        # echo "${BLUE}═══════════════════════════════════════${NC}"
        # echo "${BLUE}  Restore Production to Localhost${NC}"
        # echo "${BLUE}═══════════════════════════════════════${NC}"
        echo "  Restore Production to Localhost"

        # Create production backup
        production_backup=$(backup_production)
        echo ""

        # Restore to localhost
        restore_to_localhost "$production_backup"
        ;;

    *)
        echo "${RED}Usage: $0 {backup_localhost|backup_prd|prd_to_localhost}${NC}"
        echo ""
        echo "${BLUE}Commands:${NC}"
        echo "  backup_localhost     - Backup localhost database (uses .env.local)"
        echo "  backup_prd           - Backup production database (uses .env.production)"
        echo "  prd_to_localhost     - Restore production backup to localhost"
        echo ""
        echo "${YELLOW}Examples:${NC}"
        echo "  $0 backup_localhost      # Backup local dev database"
        echo "  $0 backup_prd            # Backup production database"
        echo "  $0 prd_to_localhost      # Sync production data to local"
        echo ""
        echo "${BLUE}Environment Files:${NC}"
        echo "  .env.local       - Local development database settings"
        echo "  .env.production  - Production database settings"
        exit 1
        ;;
esac

echo "✨ Done!"
