
var db = require('../database.js');
var m = require('multiline');
var _ = require('lodash');
var assert = require('assert');

////
//// This module contains db-functions on investment-related things
////

// Updates `offsite` and `risk` columns for this user's investment
// If successful, result will be the updated investment
// If user has no investment, result will be null.
exports.updateInvestment = function(user, opts) {
    assert(_.isNumber(opts.offsite));
    assert(_.isNumber(opts.risk));
    var sql = m(function() {/*
UPDATE investments
SET offsite = $2 AND risk = $3
WHERE user_id = $1
RETURNING *
    */});
    db.query(sql, [user.id, opts.offsite, opts.risk], function(err, result) {
        if (err) return cb(err);
        var updatedInvestment = result.rows[0] ? result.rows[0] : null;
        return cb(null, updatedInvestment);
    });
}

// Returns updated investment or null if user has no investment
exports.incInvestmentAmount = function(user, incAmount, cb) {
    assert(_.isNumber(incAmount));
    var sql = m(function() {/*
UPDATE investments
SET amount = amount + $2, high_tide = high_tide + $2
WHERE user_id = $1
RETURNING *
    */});
    db.query(sql, [user.id, opts.incAmount], function(err, result) {
        if (err) return cb(err);
        var updatedInvestment = result.rows[0] ? result.rows[0] : null;
        return cb(null, updatedInvestment);
    });
}

// Initialize an investment for a user.
// Should only be run if user doesn not yet have an invesment.
// If user already has an investment that they're adding to, use incInvestmentAmount.
// User gives us amount, offsite (optional), and risk
exports.createInvestment = function(user, opts, cb) {
    assert(_.isNumber(opts.amount));
    assert(opts.amount > 0);
    assert(_.isNumber(opts.risk));
    assert(opts.risk > 0);
    opts.offsite = opts.offsite || 0;

    var sqlCreateInvestment = m(function(){/*
INSERT INTO investments (user_id, amount, risk, offsite, high_tide)
VALUES ($1, $2, $3, $4, $5)
RETURNING *
    */});
    var sqlUpdateUserBalance = m(function() {/*
UPDATE users
SET balance_satoshis = (SELECT balance_satoshis FROM users WHERE id = $1) - $2
RETURNING *
    */});

    db.getClient(function(client, _cb) {
        userHasInvestment(client, user, function(err, doesExist) {
          if (doesExist) return _cb('User already has investment', null);
          client.query(sqlCreateInvestment,
                       [user.id, opts.amount, opts.risk, opts.offsite, opts.amount],
                       function(err, result) {
              if (err) return _cb(err);
              var createdInvestment = result.rows[0];
              client.query(sqlUpdateUserBalance,
                           [user.id, opts.amount],
                           function(err, result) {
                  if (err) return _cb(err);
                  var updatedUser = result.rows[0];
                  return _cb(null, {
                      user: updatedUser,
                      investment: createdInvestment
                  });
              });
          });
        });
    }, cb);
}

// Returns boolean, whether user has record in investments table.
exports.userHasInvestment = userHasInvestment;
function userHasInvestment(client, user, cb) {
    var sql = 'SELECT EXISTS(SELECT 1 FROM investments WHERE user_id = $1)';
    client.query(sql, [user.id], function(err, result) {
        if (err) return cb(err);
        var doesExist = result.rows[0].exists;
        return cb(null, doesExist);
    });

}

// Returns updated user or null if user has no investment
exports.divestAll = function(user, cb) {
    var sqlDeleteInvestment = m(function() {/*
DELETE FROM investments
WHERE user_id = $1
RETURNING *
    */});
    var sqlUpdateUserBalance = m(function() {/*
UPDATE users
SET balance_satoshis = (balance_satoshis + $2)
WHERE id = $1
RETURNING *
    */});

    db.getClient(function(client, _cb) {
        client.query(sqlDeleteInvestment, [user.id], function(err, result) {
            if (err) return _cb(err);
            var investment = result.rows[0];
            if (! investment) return _cb(null, null);
            var userProfit = Math.max(0, investment.amount - investment.high_tide);
            var houseCommission = userProfit * 0.1;
            var userNet = investment.amount - houseCommission;
            client.query(sqlUpdateUserBalance,
                         [user.id, userNet],
                         function(err, result) {
                var updatedUser = result.rows[0];
                return _cb(null, updatedUser);
            });
        });
    });
}

// Calculates the total amount of investor contributions for this game.
// Should be calculated at the start of game.
// Returns integer
exports.calcMaxLoss = function(cb) {
    var sql = m(function() {/*
SELECT
  SUM(LEAST(contribution, amount)) as total
FROM (
  SELECT
    (amount + offsite) * risk as contribution,
    amount
  FROM investments
) contributions
*/});
    db.query(sql, function(err, result) {
        if (err) return cb(err);
        var maxLoss = result.rows[0].total || 0;
        return cb(null, maxLoss);
    });
}
