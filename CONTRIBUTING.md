# Contributing to NorthGate Browser

We welcome contributions to NorthGate Browser! Thank you for helping us make the web a safer, more private place.

---

## Code of Conduct

Please help us maintain a friendly, welcoming, and inclusive community. Be respectful and constructive in all discussions, issues, and pull requests.

---

## Developing & Building

NorthGate is built on the Mozilla Gecko codebase. The core browser files are located under [`src/`](src/).

### 1. Build Environment Setup
To build the browser from source, you need to set up the Mozilla development dependencies:
```bash
cd src
./mach bootstrap --application-choice browser
```

### 2. Standard Build Commands
* **Full Build** (takes 1-3 hours depending on your hardware):
  ```bash
  ./mach build
  ```
* **Fast Rebuilds** (for front-end changes: JS, CSS, HTML, localizations):
  ```bash
  ./mach build faster
  ```
* **Run Browser**:
  ```bash
  ./mach run
  ```

---

## Code Style & Formatting

We maintain strict code style guidelines:
* **No Emojis**: Our style guide forbids the use of emojis in source code or commit messages.
* **Auto-Formatter**: Always format your code before creating a pull request. Run:
  ```bash
  ./mach format
  ```
* **Rust code**: Keep the Rust components (e.g. `src/toolkit/components/northgate/`) properly formatted using standard `rustfmt` rules, which is automatically handled by `./mach format`.

---

## Machine Learning Pipeline

If you are modifying the phishing classifier model:
1. The training scripts, dataset builder, and feature extractors are in [`ml-model/`](ml-model/).
2. Run the offline scikit-learn training pipeline to generate the `.onnx` model file.
3. Export the model and copy the resulting `northgate_phishing.onnx` to `src/toolkit/components/northgate/model/`.
4. Run static validation on the features in Rust to ensure parity with scikit-learn's feature extraction.

---

## Submitting Pull Requests

1. **Create a Branch**: Create a descriptive branch name (e.g. `fix/privilege-escalation`).
2. **Commit Messages**: Write clear, descriptive commit messages documenting *why* changes were made.
3. **Format**: Verify that `./mach format` runs cleanly on all modified files.
4. **Push & Pull Request**: Push your branch and open a pull request against the `ci/windows-build` or `main` branch.
