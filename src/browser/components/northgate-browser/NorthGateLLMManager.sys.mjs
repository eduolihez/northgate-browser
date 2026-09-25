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

function toHex(bytes) {
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

async function sha256OfFile(path) {
  const bytes = await IOUtils.read(path);
  const hasher = Cc["@mozilla.org/security/hash;1"].createInstance(
    Ci.nsICryptoHash
  );
  hasher.init(Ci.nsICryptoHash.SHA256);
  hasher.update(bytes, bytes.length);
  const digest = hasher.finish(false);
  const raw = Uint8Array.from(digest, c => c.charCodeAt(0));
  return toHex(raw);
}

export class NorthGateLLMManager {
  #profileDir;
  #modelUrl;
  #modelSha256;
  #fetchImpl;
  #state = "not-downloaded";

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
    return PathUtils.join(this.#profileDir, "northgate", "models", MODEL_FILENAME);
  }

  getState() {
    return this.#state;
  }

  /**
   * Downloads and verifies the model if it is not already present. Safe to
   * call repeatedly; a no-op once state is "ready".
   *
   * @param {(fraction: number) => void} [onProgress]
   */
  async ensureDownloaded(onProgress) {
    if (this.#state === "ready" && (await IOUtils.exists(this.modelPath()))) {
      return;
    }

    this.#state = "downloading";
    const destination = this.modelPath();
    const partial = `${destination}.partial`;

    try {
      await IOUtils.makeDirectory(PathUtils.parent(destination), {
        createAncestors: true,
      });

      const response = await this.#fetchImpl(this.#modelUrl);
      const total = Number(response.headers?.get?.("content-length")) || 0;
      const reader = response.body?.getReader?.();
      const chunks = [];
      let received = 0;

      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          chunks.push(value);
          received += value.length;
          if (total && onProgress) {
            onProgress(received / total);
          }
        }
      } else {
        chunks.push(new Uint8Array(await response.arrayBuffer()));
      }

      const bytes = new Uint8Array(received || chunks.reduce((n, c) => n + c.length, 0));
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }

      await IOUtils.write(partial, bytes);

      const actualHash = await sha256OfFile(partial);
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
