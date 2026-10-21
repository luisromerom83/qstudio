const path = require('path');
const { createDasRouter, status } = require('../das-inbox/router');

/**
 * Online banking
 * --------------
 * A sample online banking portal whose "Statements" section is the Digital Advantage Inbox: same Quadient Cloud
 * application, users and sign-in (Integrated Server-Side Authentication) as das-inbox, with its own front end and
 * session cookie. Balances, accounts, cards and movements are sample data made up in the browser.
 */
module.exports = {
  router: createDasRouter({ publicDir: path.join(__dirname, 'public'), cookieName: 'das_bank_sid', cookiePath: '/das-banking' }),
  status
};
