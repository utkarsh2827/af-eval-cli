# App Function Evaluation CLI

A command-line interface for evaluating App Functions using Gemini CLI and MCP Inspector.

## Features

- **App Function to MCP Tool Conversion**: Converts App Functions to MCP tools.
- **Evaluation**: Evaluates App Functions with Gemini CLI and MCP Inspector.

## Installation

```bash
npm install -g .
```

## Usage

### Run MCP Inspector

```bash
npx @modelcontextprotocol/inspector node build/index.js <package_name>
```

### Run DeepEval Evaluation Script

You can evaluate the App Functions using the provided `eval_mcp.py` script. This script reads test cases from a JSON file, uses an LLM of your choice to act as an agent, and uses DeepEval's `MCPUseMetric` to evaluate the interactions.

**Setup**:
1. Ensure your Python virtual environment is set up and dependencies are installed (DeepEval, MCP, Anthropic, etc.).
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

2. Export your API key for the agent you plan to use:
```bash
export GEMINI_API_KEY="your-gemini-key"
```

**Run Evaluation**:

1. Write test cases in `test_cases.json`:
```json
[
  {
        "input": "Create a new task to buy milk. The description should be 'Get 2 gallons of whole milk' and it should not repeat.",
        "expected_tool": "createTask",
        "expected_args": {
            "title": "buy milk",
            "content": "Get 2 gallons of whole milk",
            "recurrenceSchedule": "none"
        }
    }
]
```

2. Run the script:
```bash
python eval_mcp.py --package <package_name> --test-cases test_cases.json --model gemini-3-flash-preview
```

Available arguments:
- `--package`: (Required) The Android package name containing the App Functions.
- `--test-cases`: Path to the JSON file containing test cases (default: `test_cases.json`).
- `--model`: The LLM model to use as the agent (default: `gemini-2.5-flash`).

To view the results in a dashboard, you can optionally set `CONFIDENT_API_KEY` before running the evaluation.


