/**
 * Downloads, checksum-verifies, and tracks the on-disk state of the
 * quantized LLM model used for on-demand alert explanations.
 *
 * This is the ONLY network request NorthGate's LLM feature ever makes: a
 * one-time download of a project-published, checksum-pinned .gguf file,
 * triggered only after explicit user consent. Once cached, generation is
 * fully local (see nsINorthGateLLM).
 */

const DEFAULT_MODEL_URL =
  "https://github.com/eduolihez/northgate-browser/releases/download/llm-model-v1/qwen2.5-1.5b-instruct-q4_k_m.gguf";
// SHA-256 of the file published at DEFAULT_MODEL_URL (see Task 1).
const DEFAULT_MODEL_SHA256 =
  "6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e";
const MODEL_FILENAME = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
// Read size used when re-hashing a cached model, so memory stays bounded.
const HASH_CHUNK_BYTES = 4 * 1024 * 1024;

function createSha256() {
  const hasher = Cc["@mozilla.org/security/hash;1"].createInstance(
    Ci.nsICryptoHash
  );
  hasher.init(Ci.nsICryptoHash.SHA256);
  return hasher;
}

function finishHex(hasher) {
  const digest = hasher.finish(false);
  return Array.from(digest, c =>
    c.charCodeAt(0).toString(16).padStart(2, "0")
  ).join("");
}

async function sha256OfFile(path) {
  const hasher = createSha256();
  let offset = 0;
  for (;;) {
    const chunk = await IOUtils.read(path, {
      offset,
      maxBytes: HASH_CHUNK_BYTES,
    });
    if (chunk.length) {
      hasher.update(chunk, chunk.length);
      offset += chunk.length;
    }
    if (chunk.length < HASH_CHUNK_BYTES) {
      break;
    }
  }
  return finishHex(hasher);
}

/**
 * Tracks and drives the model's download state for one profile directory.
 */
export class NorthGateLLMManager {
  #profileDir;
  #modelUrl;
  #modelSha256;
  #fetchImpl;
  #state = "not-downloaded";
  #inFlight = null;
  #progressListeners = new Set();

  constructor({
    profileDir,
    modelUrl = DEFAULT_MODEL_URL,
    modelSha256 = DEFAULT_MODEL_SHA256,
    fetchImpl = fetch,
  } = {}) {
    this.#profileDir = profileDir;
    this.#modelUrl = modelUrl;
    this.#modelSha256 = modelSha256;
    this.#fetchImpl = fetchImpl;
  }

  modelPath() {
    return PathUtils.join(
      this.#profileDir,
      "northgate",
      "models",
      MODEL_FILENAME
    );
  }

  getState() {
    return this.#state;
  }

  /**
   * Like getState(), but reports "cached-unverified" when the in-memory state
   * is "not-downloaded" (e.g. after a restart) yet a model file already exists
   * on disk. Only checks existence; the checksum is verified by
   * ensureDownloaded() before the file is used.
   *
   * @returns {Promise<string>}
   */
  async getDisplayState() {
    if (
      this.#state === "not-downloaded" &&
      (await IOUtils.exists(this.modelPath()))
    ) {
      return "cached-unverified";
    }
    return this.#state;
  }

  /**
   * Checks for a model already on disk (e.g. from a previous session) whose
   * checksum matches #modelSha256, adopting it as "ready" if so. A file that
   * exists but fails the checksum is treated as absent and removed.
   *
   * @returns {Promise<boolean>} true if an existing on-disk model was
   *   adopted and #state is now "ready".
   */
  async #adoptExistingModel() {
    const destination = this.modelPath();
    if (!(await IOUtils.exists(destination))) {
      return false;
    }

    const actualHash = await sha256OfFile(destination);
    if (actualHash !== this.#modelSha256) {
      await IOUtils.remove(destination, { ignoreAbsent: true });
      return false;
    }

    this.#state = "ready";
    return true;
  }

  /**
   * Downloads and verifies the model if it is not already present. Safe to
   * call repeatedly; a no-op once state is "ready". Also recognizes a model
   * already cached on disk from a prior session (the singleton's in-memory
   * state resets on every browser restart, but the file persists), so the
   * model is downloaded only once per profile, per the design intent.
   *
   * Concurrent callers share a single in-flight operation rather than racing
   * on the same .partial file; every caller's onProgress is notified.
   *
   * @param {(fraction: number) => void} [onProgress]
   * @param {object} [options]
   * @param {boolean} [options.allowNetwork=true] When false, only an already
   *   cached, checksum-valid model is accepted; if there is none, rejects and
   *   leaves state "not-downloaded" instead of downloading. Used when the user
   *   has not consented to a download in this session.
   * @returns {Promise<void>}
   */
  ensureDownloaded(onProgress, { allowNetwork = true } = {}) {
    if (onProgress) {
      this.#progressListeners.add(onProgress);
    }
    if (!this.#inFlight) {
      this.#inFlight = this.#ensureDownloadedImpl(allowNetwork).finally(() => {
        this.#inFlight = null;
        this.#progressListeners.clear();
      });
    }
    return this.#inFlight;
  }

  #reportProgress(fraction) {
    for (const listener of this.#progressListeners) {
      try {
        listener(fraction);
      } catch (_e) {
        // A listener going away (e.g. a closed dashboard) must never abort
        // the download.
      }
    }
  }

  async #ensureDownloadedImpl(allowNetwork) {
    if (this.#state === "ready" && (await IOUtils.exists(this.modelPath()))) {
      return;
    }

    if (await this.#adoptExistingModel()) {
      return;
    }

    if (!allowNetwork) {
      this.#state = "not-downloaded";
      throw new Error("no verified cached model; download requires consent");
    }

    this.#state = "downloading";
    const destination = this.modelPath();
    const partial = `${destination}.partial`;

    try {
      await IOUtils.makeDirectory(PathUtils.parent(destination), {
        createAncestors: true,
      });
      await IOUtils.remove(partial, { ignoreAbsent: true });

      const response = await this.#fetchImpl(this.#modelUrl);
      if (response.ok === false) {
        throw new Error(`model download failed: HTTP ${response.status}`);
      }
      const total = Number(response.headers?.get?.("content-length")) || 0;
      const reader = response.body?.getReader?.();
      const hasher = createSha256();
      let received = 0;

      const consume = async chunk => {
        hasher.update(chunk, chunk.length);
        await IOUtils.write(partial, chunk, { mode: "appendOrCreate" });
        received += chunk.length;
        if (total) {
          this.#reportProgress(received / total);
        }
      };

      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          await consume(value);
        }
      } else {
        await consume(new Uint8Array(await response.arrayBuffer()));
      }

      const actualHash = finishHex(hasher);
      if (actualHash !== this.#modelSha256) {
        await IOUtils.remove(partial, { ignoreAbsent: true });
        this.#state = "error";
        throw new Error(
          `model download checksum mismatch: expected ${this.#modelSha256}, got ${actualHash}`
        );
      }

      await IOUtils.move(partial, destination);
      this.#state = "ready";
    } catch (e) {
      await IOUtils.remove(partial, { ignoreAbsent: true });
      this.#state = "error";
      throw e;
    }
  }
}

export const northGateLLMManager = new NorthGateLLMManager({
  profileDir: PathUtils.profileDir,
});
