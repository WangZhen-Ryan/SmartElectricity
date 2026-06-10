class BaseAdapter {
  constructor(config = {}) {
    this.config = config;
  }

  async getTelemetry() {
    throw new Error("Adapter does not implement telemetry.");
  }

  async getCommandHealth() {
    return {
      ok: true,
      commandCapable: false,
      mode: "read-only-stub",
      message: "Adapter is loaded, but command execution is not implemented yet.",
    };
  }

  async sendCommand(_command) {
    return {
      ok: false,
      accepted: false,
      error: "Adapter command execution is not implemented yet.",
    };
  }
}

module.exports = BaseAdapter;
