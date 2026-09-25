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
