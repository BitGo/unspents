const t = require('tcomb');

const PositiveInteger = t.refinement(t.Integer, (n) => n >= 0, 'PositiveInteger');


module.exports = { PositiveInteger };
