const serverlessExpress = require('@vendia/serverless-express');
const app = require('./server');

const handler = serverlessExpress({ app });

exports.handler = async (event, context) => {
  // Scheduled Plaid balance refresh triggered by EventBridge Scheduler
  if (event.source === 'aws.scheduler') {
    console.log('Scheduled Plaid refresh triggered');
    // TODO: invoke refresh logic directly (currently a placeholder)
    return { statusCode: 200 };
  }

  // All other events are HTTP requests routed through API Gateway
  return handler(event, context);
};
