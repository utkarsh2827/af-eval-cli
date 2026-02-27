# App Function Evaluation CLI

A robust toolkit for bridging Android AppFunctions to the **Model Context Protocol (MCP)**. This project provides a foundational bridge and a **developer template** for programmatic evaluation using the Gemini SDK and DeepEval.

---

## 🚀 Features

* **MCP Bridging**: Automatically exposes Android App's AppFunctions as an MCP Server.
* **Evaluation Framework (Template)**: A scaffold for running metric-based tests (`MCPUseMetric`, `ToolCorrectnessMetric`) against AI-driven app interactions.
* **Interactive Debugging**: Full compatibility with the MCP Inspector for manual function testing.
---

## 🛠 Setup & Installation

This project requires **Node.js** (for the MCP server) and **Python 3.9+** (for the evaluation framework).

### 1. Node.js Environment

Install the CLI dependencies to manage the MCP server lifecycle:

```bash
npm install -g .

```

### 2. Python Environment (For Custom Evals)

The evaluation scripts are provided as templates. Set up a virtual environment to begin customizing your tests:

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

```

### 3. API Configuration

```bash
export GEMINI_API_KEY="your-gemini-key"
# Optional: For syncing custom results to the DeepEval dashboard
export CONFIDENT_API_KEY="your-confident-ai-key"

```

---

## 📖 Usage

### Manual Testing (MCP Inspector)

Before writing automated scripts, verify your functions are correctly exposed to the protocol:

```bash
npx @modelcontextprotocol/inspector node build/index.js <package_name>

```

### Automated Evaluation (Template)

The included `eval_mcp.py` is a **reference implementation**. Developers are encouraged to modify this script or use it as a boilerplate to fit their specific tool-calling schemas and agentic workflows.

#### 1. Define Your Test Cases

Create a `test_cases.json` to define the ground truth for your functions:

```json
[
  {
    "input": "Create a new task to buy milk. The description should be 'Get 2 gallons of whole milk'.",
    "expected_tool": "createTask",
    "expected_args": {
      "title": "buy milk",
      "content": "Get 2 gallons of whole milk"
    }
  }
]
```

#### 2. Run/Modify the Eval Script

```bash
python eval_mcp.py --package <package_name> --test-cases test_cases.json --model gemini-2.0-flash

```

| Argument | Description | Default |
| --- | --- | --- |
| `--package` | **(Required)** The Android package name. | N/A |
| `--test-cases` | Path to your JSON test definitions. | `test_cases.json` |
| `--model` | The Gemini model used to drive the agent. | `gemini-2.0-flash` |

---

## 📈 Customizing the Evaluation

This project is built to be a starting point. You can extend the provided Python templates to include:

* **Custom DeepEval Metrics**: Implement `BaseMetric` to handle fuzzy matching for complex Android-specific arguments.
* **Latency Benchmarks**: Measure the round-trip time of App Function responses via the MCP bridge.
* **Integration Tests**: Script complex multi-step interactions where one App Function output serves as the input for another.