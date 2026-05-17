#!/usr/bin/env node

import { createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

const DEFAULT_INPUT = "data/qwen3_card_embeddings.float16.npy";
const DEFAULT_IDS = "data/qwen3_card_embedding_ids.json";
const DEFAULT_METADATA = "data/qwen3_card_embeddings.metadata.json";
const DEFAULT_OUTPUT = "data/convex_card_embeddings.jsonl";
const DEFAULT_DIMENSIONS = 4096;

const args = parseArgs(process.argv.slice(2));
const inputPath = args.input ?? DEFAULT_INPUT;
const idsPath = args.ids ?? DEFAULT_IDS;
const metadataPath = args.metadata ?? DEFAULT_METADATA;
const outputPath = args.output ?? DEFAULT_OUTPUT;
const dimensions = Number(args.dimensions ?? DEFAULT_DIMENSIONS);

if (!Number.isInteger(dimensions) || dimensions < 2) {
  throw new Error("--dimensions must be an integer greater than or equal to 2");
}

const [npyBuffer, ids, metadata] = await Promise.all([
  readFile(inputPath),
  readJson(idsPath),
  readJson(metadataPath),
]);

if (!Array.isArray(ids)) {
  throw new Error(`${idsPath} must contain a JSON array`);
}

const npy = parseNpy(npyBuffer);
if (npy.dtype !== "<f2") {
  throw new Error(`${inputPath} must contain little-endian float16 data`);
}
if (npy.shape.length !== 2) {
  throw new Error(`${inputPath} must be a 2D embedding matrix`);
}

const [rowCount, sourceDimensions] = npy.shape;
if (rowCount !== ids.length) {
  throw new Error(
    `embedding rows (${rowCount}) do not match id count (${ids.length})`
  );
}
if (dimensions > sourceDimensions) {
  throw new Error(
    `requested ${dimensions} dimensions from ${sourceDimensions}-dimensional embeddings`
  );
}

const output = createWriteStream(outputPath, { encoding: "utf8" });
let written = 0;

for (let row = 0; row < ids.length; row += 1) {
  const oracleId = ids[row];
  if (typeof oracleId !== "string" || oracleId.length === 0) continue;

  const embedding = readProjectedEmbedding(npy, row, dimensions);
  const doc = {
    oracleId,
    embedding,
    embeddingModel: metadata.model ?? basename(inputPath),
    embeddingDimensions: dimensions,
    sourceDimensions,
    updatedAt: Date.now(),
  };

  if (!output.write(`${JSON.stringify(doc)}\n`)) {
    await onceDrain(output);
  }
  written += 1;
}

await closeStream(output);
console.log(`wrote ${written} Convex card embedding documents to ${outputPath}`);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }
    parsed[key] = value;
    i += 1;
  }
  return parsed;
}

function parseNpy(buffer) {
  const magic = buffer.subarray(0, 6).toString("binary");
  if (magic !== "\x93NUMPY") {
    throw new Error("Input is not a NumPy .npy file");
  }

  const major = buffer.readUInt8(6);
  let headerLength;
  let offset;
  if (major === 1) {
    headerLength = buffer.readUInt16LE(8);
    offset = 10;
  } else if (major === 2 || major === 3) {
    headerLength = buffer.readUInt32LE(8);
    offset = 12;
  } else {
    throw new Error(`Unsupported .npy version ${major}`);
  }

  const header = buffer
    .subarray(offset, offset + headerLength)
    .toString("latin1");
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  const fortranOrder = /'fortran_order':\s*(True|False)/.exec(header)?.[1];
  const shapeText = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1];
  if (!descr || !fortranOrder || !shapeText) {
    throw new Error("Could not parse .npy header");
  }
  if (fortranOrder !== "False") {
    throw new Error("Fortran-order .npy arrays are not supported");
  }

  const shape = shapeText
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(Number);
  return {
    dtype: descr,
    shape,
    dataOffset: offset + headerLength,
    buffer,
  };
}

function readProjectedEmbedding(npy, row, dimensions) {
  const sourceDimensions = npy.shape[1];
  const rowOffset = npy.dataOffset + row * sourceDimensions * 2;
  const embedding = new Array(dimensions);
  let magnitude = 0;

  for (let col = 0; col < dimensions; col += 1) {
    const value = float16ToNumber(npy.buffer.readUInt16LE(rowOffset + col * 2));
    embedding[col] = value;
    magnitude += value * value;
  }

  magnitude = Math.sqrt(magnitude);
  if (magnitude === 0) return embedding;

  for (let col = 0; col < dimensions; col += 1) {
    embedding[col] /= magnitude;
  }
  return embedding;
}

function float16ToNumber(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exponent = (bits >> 10) & 0x1f;
  const fraction = bits & 0x03ff;

  if (exponent === 0) {
    return sign * Math.pow(2, -14) * (fraction / 1024);
  }
  if (exponent === 0x1f) {
    return fraction === 0 ? sign * Infinity : NaN;
  }
  return sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
}

function onceDrain(stream) {
  return new Promise((resolve, reject) => {
    function cleanup() {
      stream.off("drain", onDrain);
      stream.off("error", onError);
    }
    function onDrain() {
      cleanup();
      resolve();
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    stream.once("drain", onDrain);
    stream.once("error", onError);
  });
}

function closeStream(stream) {
  return new Promise((resolve, reject) => {
    function cleanup() {
      stream.off("finish", onFinish);
      stream.off("error", onError);
    }
    function onFinish() {
      cleanup();
      resolve();
    }
    function onError(error) {
      cleanup();
      reject(error);
    }
    stream.once("finish", onFinish);
    stream.once("error", onError);
    stream.end();
  });
}
