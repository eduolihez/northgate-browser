"use strict";

const { NorthGateLLMManager } = ChromeUtils.importESModule(
  "moz-src:///browser/components/northgate-browser/NorthGateLLMManager.sys.mjs"
);

const MODEL_BYTES = new TextEncoder().encode("fake-model-bytes-for-testing");

function sha256Hex(bytes) {
  let hasher = Cc["@mozilla.org/security/hash;1"].createInstance(
    Ci.nsICryptoHash
  );
  hasher.init(Ci.nsICryptoHash.SHA256);
  hasher.update(bytes, bytes.length);
  let hash = hasher.finish(false);
  return Array.from(hash, c =>
    c.charCodeAt(0).toString(16).padStart(2, "0")
  ).join("");
}

add_task(async function test_state_starts_not_downloaded() {
  let manager = new NorthGateLLMManager({
    profileDir: PathUtils.tempDir,
  });
  Assert.equal(manager.getState(), "not-downloaded");
});

add_task(async function test_ensure_downloaded_verifies_checksum() {
  let expectedHash = sha256Hex(MODEL_BYTES);
  let manager = new NorthGateLLMManager({
    profileDir: PathUtils.join(PathUtils.tempDir, "ngllm-verify"),
    modelUrl: "https://example.invalid/model.gguf",
    modelSha256: expectedHash,
    fetchImpl: async () => new Response(MODEL_BYTES),
  });

  await manager.ensureDownloaded();

  Assert.equal(manager.getState(), "ready");
  let onDisk = await IOUtils.read(manager.modelPath());
  Assert.deepEqual(Array.from(onDisk), Array.from(MODEL_BYTES));
});

add_task(async function test_ensure_downloaded_reuses_model_from_prior_session() {
  let expectedHash = sha256Hex(MODEL_BYTES);
  let profileDir = PathUtils.join(PathUtils.tempDir, "ngllm-persist");

  let firstSessionManager = new NorthGateLLMManager({
    profileDir,
    modelUrl: "https://example.invalid/model.gguf",
    modelSha256: expectedHash,
    fetchImpl: async () => new Response(MODEL_BYTES),
  });
  await firstSessionManager.ensureDownloaded();
  Assert.equal(firstSessionManager.getState(), "ready");

  // Simulate a browser restart: a brand-new manager instance, with no
  // in-memory state, pointed at the same profile directory. Its fetchImpl
  // must never be called, proving the on-disk model was reused instead of
  // being re-downloaded.
  let secondSessionManager = new NorthGateLLMManager({
    profileDir,
    modelUrl: "https://example.invalid/model.gguf",
    modelSha256: expectedHash,
    fetchImpl: async () => {
      throw new Error("fetchImpl should not be called when a valid model is already on disk");
    },
  });
  Assert.equal(secondSessionManager.getState(), "not-downloaded");

  await secondSessionManager.ensureDownloaded();

  Assert.equal(secondSessionManager.getState(), "ready");
  let onDisk = await IOUtils.read(secondSessionManager.modelPath());
  Assert.deepEqual(Array.from(onDisk), Array.from(MODEL_BYTES));
});

add_task(async function test_ensure_downloaded_redownloads_on_stale_checksum_from_disk() {
  let expectedHash = sha256Hex(MODEL_BYTES);
  let profileDir = PathUtils.join(PathUtils.tempDir, "ngllm-stale");

  // Simulate a leftover file from a previous release that does not match
  // the currently expected checksum (e.g. corrupted, or an old model
  // version left over).
  let staleManager = new NorthGateLLMManager({
    profileDir,
    modelUrl: "https://example.invalid/model.gguf",
    modelSha256: "1111111111111111111111111111111111111111111111111111111111111111",
    fetchImpl: async () => new Response(MODEL_BYTES),
  });
  await IOUtils.makeDirectory(PathUtils.parent(staleManager.modelPath()), {
    createAncestors: true,
  });
  await IOUtils.write(staleManager.modelPath(), MODEL_BYTES);

  let freshBytes = new TextEncoder().encode("fresh-model-bytes-for-testing");
  let freshHash = sha256Hex(freshBytes);
  let manager = new NorthGateLLMManager({
    profileDir,
    modelUrl: "https://example.invalid/model.gguf",
    modelSha256: freshHash,
    fetchImpl: async () => new Response(freshBytes),
  });

  await manager.ensureDownloaded();

  Assert.equal(manager.getState(), "ready");
  let onDisk = await IOUtils.read(manager.modelPath());
  Assert.deepEqual(
    Array.from(onDisk),
    Array.from(freshBytes),
    "stale on-disk model must be replaced by a fresh download"
  );
});

add_task(async function test_ensure_downloaded_rejects_checksum_mismatch() {
  let manager = new NorthGateLLMManager({
    profileDir: PathUtils.join(PathUtils.tempDir, "ngllm-mismatch"),
    modelUrl: "https://example.invalid/model.gguf",
    modelSha256: "0000000000000000000000000000000000000000000000000000000000000000",
    fetchImpl: async () => new Response(MODEL_BYTES),
  });

  await Assert.rejects(
    manager.ensureDownloaded(),
    /checksum mismatch/,
    "should reject on checksum mismatch"
  );
  Assert.equal(manager.getState(), "error");
  Assert.ok(
    !(await IOUtils.exists(manager.modelPath())),
    "partial file must not be left on disk"
  );
});
