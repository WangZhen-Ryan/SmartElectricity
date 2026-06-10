const net = require("net");

function buildMbap(transactionId, unitId, pduLength) {
  const header = Buffer.alloc(7);
  header.writeUInt16BE(transactionId & 0xffff, 0);
  header.writeUInt16BE(0, 2);
  header.writeUInt16BE(pduLength + 1, 4);
  header.writeUInt8(unitId & 0xff, 6);
  return header;
}

function decodeRegisters(registers, format = "u16", byteOrder = "ABCD") {
  if (!Array.isArray(registers) || !registers.length) return null;
  const normalized = String(format || "u16").toLowerCase();
  const order = String(byteOrder || "ABCD").toUpperCase();

  if (normalized === "u16") return registers[0] >>> 0;
  if (normalized === "i16") {
    const value = registers[0] & 0xffff;
    return value & 0x8000 ? value - 0x10000 : value;
  }

  const bytes = [];
  for (const reg of registers) {
    bytes.push((reg >> 8) & 0xff, reg & 0xff);
  }
  if (bytes.length < 4) return null;

  const reorder = {
    ABCD: [0, 1, 2, 3],
    BADC: [1, 0, 3, 2],
    CDAB: [2, 3, 0, 1],
    DCBA: [3, 2, 1, 0],
  }[order] || [0, 1, 2, 3];

  const buffer = Buffer.from(reorder.map((index) => bytes[index] ?? 0));

  if (normalized === "u32") return buffer.readUInt32BE(0);
  if (normalized === "i32") return buffer.readInt32BE(0);
  if (normalized === "f32" || normalized === "float") return buffer.readFloatBE(0);
  return null;
}

function encodeRegisterValue(value, format = "u16", byteOrder = "ABCD") {
  const normalized = String(format || "u16").toLowerCase();
  if (normalized === "u16" || normalized === "i16") {
    const v = Number(value) || 0;
    return [v & 0xffff];
  }

  const buffer = Buffer.alloc(4);
  const numeric = Number(value) || 0;
  if (normalized === "u32") buffer.writeUInt32BE(numeric >>> 0, 0);
  else if (normalized === "i32") buffer.writeInt32BE(Math.trunc(numeric), 0);
  else buffer.writeFloatBE(numeric, 0);

  const order = String(byteOrder || "ABCD").toUpperCase();
  const reorder = {
    ABCD: [0, 1, 2, 3],
    BADC: [1, 0, 3, 2],
    CDAB: [2, 3, 0, 1],
    DCBA: [3, 2, 1, 0],
  }[order] || [0, 1, 2, 3];
  const ordered = Buffer.from(reorder.map((index) => buffer[index]));
  return [ordered.readUInt16BE(0), ordered.readUInt16BE(2)];
}

function connectClient({ host, port, timeoutMs = 4000 }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) || 502 });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Modbus TCP timeout."));
    }, timeoutMs);

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function sendRequest(socket, packet, transactionId, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Modbus response timeout."));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      socket.off("data", onData);
      socket.off("error", onError);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onData(data) {
      if (data.length < 9) return;
      const responseTransactionId = data.readUInt16BE(0);
      if (responseTransactionId !== transactionId) return;
      const functionCode = data.readUInt8(7);
      if (functionCode & 0x80) {
        cleanup();
        reject(new Error(`Modbus exception ${data.readUInt8(8)}`));
        return;
      }
      cleanup();
      resolve(data);
    }

    socket.on("data", onData);
    socket.once("error", onError);
    socket.write(packet);
  });
}

async function withClient(config, fn) {
  const socket = await connectClient(config);
  try {
    return await fn(socket);
  } finally {
    socket.end();
    socket.destroy();
  }
}

async function readHoldingRegisters(config, address, count) {
  return withClient(config, async (socket) => {
    const transactionId = Math.floor(Math.random() * 0xffff);
    const pdu = Buffer.alloc(5);
    pdu.writeUInt8(0x03, 0);
    pdu.writeUInt16BE(address, 1);
    pdu.writeUInt16BE(count, 3);
    const packet = Buffer.concat([
      buildMbap(transactionId, config.unitId || 1, pdu.length),
      pdu,
    ]);
    const response = await sendRequest(socket, packet, transactionId);
    const byteCount = response.readUInt8(8);
    const registers = [];
    for (let offset = 0; offset < byteCount; offset += 2) {
      registers.push(response.readUInt16BE(9 + offset));
    }
    return registers;
  });
}

async function writeRegisters(config, address, values) {
  return withClient(config, async (socket) => {
    const transactionId = Math.floor(Math.random() * 0xffff);
    let pdu;
    if (values.length === 1) {
      pdu = Buffer.alloc(5);
      pdu.writeUInt8(0x06, 0);
      pdu.writeUInt16BE(address, 1);
      pdu.writeUInt16BE(values[0], 3);
    } else {
      pdu = Buffer.alloc(6 + values.length * 2);
      pdu.writeUInt8(0x10, 0);
      pdu.writeUInt16BE(address, 1);
      pdu.writeUInt16BE(values.length, 3);
      pdu.writeUInt8(values.length * 2, 5);
      values.forEach((value, index) => {
        pdu.writeUInt16BE(value, 6 + index * 2);
      });
    }
    const packet = Buffer.concat([
      buildMbap(transactionId, config.unitId || 1, pdu.length),
      pdu,
    ]);
    await sendRequest(socket, packet, transactionId);
    return { ok: true };
  });
}

module.exports = {
  readHoldingRegisters,
  writeRegisters,
  decodeRegisters,
  encodeRegisterValue,
};
