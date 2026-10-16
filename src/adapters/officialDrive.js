'use strict';

const { Cloud123Adapter } = require('./cloud123');

class OfficialDriveAdapter extends Cloud123Adapter {
  constructor(options = {}) { super(options); }
}

module.exports = { OfficialDriveAdapter };
