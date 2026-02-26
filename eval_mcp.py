import asyncio
import json
import os
import argparse
from contextlib import AsyncExitStack
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from deepeval.test_case import MCPServer, MCPToolCall, LLMTestCase, ToolCall, ToolCallParams
from deepeval.metrics import MCPUseMetric, ToolCorrectnessMetric
from deepeval import evaluate
async def connect_and_run(test_case_data, package_name, model_choice):
    server_params = StdioServerParameters(
        command="node",
        args=["build/index.js", package_name],
        env=os.environ.copy()
    )
    
    mcp_servers = []
    tools_called = []
    
    async with AsyncExitStack() as stack:
        read, write = await stack.enter_async_context(stdio_client(server_params))
        session = await stack.enter_async_context(ClientSession(read, write))
        
        await session.initialize()
        tool_list = await session.list_tools()
        
        mcp_servers.append(MCPServer(
             server_name="af-eval-cli",
             transport="stdio",
             available_tools=tool_list.tools,
        ))
        
        prompt = test_case_data["input"]
        
        expected_tool_name = test_case_data.get("expected_tool")
        expected_args = test_case_data.get("expected_args", {})
        expected_tools = []
        if expected_tool_name:
            expected_tools.append(ToolCall(name=expected_tool_name, input_parameters=expected_args))
        
        print(f"Testing input: '{prompt}' with model: {model_choice}")
        
        from google import genai
        from google.genai import types
        
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            print("Error: GEMINI_API_KEY environment variable is not set. Please set it to run evaluations with Gemini.")
            return LLMTestCase(
                input=prompt,
                actual_output="Error: GEMINI_API_KEY not set",
                mcp_servers=mcp_servers,
                mcp_tools_called=tools_called,
                tools_called=[ToolCall(name=t.name, input_parameters=t.args) for t in tools_called],
                expected_tools=expected_tools
            )

        client = genai.Client(api_key=api_key)
        
        config = types.GenerateContentConfig(
            tools=[session],
            temperature=1.0,
            automatic_function_calling=types.AutomaticFunctionCallingConfig(
                disable=True
            ),
        )
        
        try:
            response = await client.aio.models.generate_content(
                model=model_choice,
                contents=prompt,
                config=config
            )
            
            actual_output = ""
            if response.candidates and response.candidates[0].content and response.candidates[0].content.parts:
                for part in response.candidates[0].content.parts:
                    if part.text:
                        actual_output += part.text
                    elif part.function_call:
                        tool_name = part.function_call.name
                        tool_args = part.function_call.args if hasattr(part.function_call, 'args') else {}
                        
                        # Convert protocol buffers struct to dict if needed
                        if hasattr(tool_args, 'items'):
                            tool_args = {k: v for k, v in tool_args.items()}
                            
                        print(f"Agent wants to call tool: {tool_name} with args: {tool_args}")
                        try:
                            result = await session.call_tool(tool_name, tool_args)
                            print("Tool executed successfully")
                        except Exception as e:
                            print(f"Tool execution failed: {e}")
                            result = str(e)
    
                        tools_called.append(MCPToolCall(
                            name=tool_name,
                            args=tool_args,
                            result=result
                        ))
                        actual_output += f"Called tool {tool_name}."
        except Exception as e:
            print(f"Gemini API Error: {e}")
            actual_output = f"Error: {e}"
        
        if not actual_output:
            actual_output = "(No output or tool calls generated)"
            
    tc = LLMTestCase(
        input=prompt,
        actual_output=actual_output,
        mcp_servers=mcp_servers,
        mcp_tools_called=tools_called,
        tools_called=[ToolCall(name=t.name, input_parameters=t.args) for t in tools_called],
        expected_tools=expected_tools
    )
    return tc

def main():
    parser = argparse.ArgumentParser(description="Evaluate AppFunctions via MCP")
    parser.add_argument("--test-cases", default="test_cases.json", help="Path to JSON file with test cases")
    parser.add_argument("--package", required=True, help="App package name e.g., com.example.app")
    parser.add_argument("--model", default="gemini-2.5-flash", help="LLM to use as the agent")
    args = parser.parse_args()
    
    with open(args.test_cases, "r") as f:
        tests = json.load(f)
        
    print(f"Found {len(tests)} test cases.")
        
    test_cases = []
    for t in tests:
        tc = asyncio.run(connect_and_run(t, args.package, args.model))
        test_cases.append(tc)
        
    print("Running evaluations...")
    # Initialize the metric with the same model used for the agent 
    # Initialize the metric with the same model used for the agent 
    if not os.environ.get("GOOGLE_API_KEY") and not os.environ.get("GEMINI_API_KEY"):
        print("Error: GOOGLE_API_KEY or GEMINI_API_KEY environment variable is not set. Please set it to run evaluations with Gemini.")
        return
    from deepeval.models import GeminiModel
    if not os.environ.get("GOOGLE_API_KEY") and os.environ.get("GEMINI_API_KEY"):
        os.environ["GOOGLE_API_KEY"] = os.environ.get("GEMINI_API_KEY")
    eval_model = GeminiModel(args.model)
    mcp_metric = MCPUseMetric(model=eval_model)
    tool_metric = ToolCorrectnessMetric(model=eval_model, evaluation_params=[ToolCallParams.INPUT_PARAMETERS])
    
    evaluate(test_cases, [mcp_metric, tool_metric])

if __name__ == "__main__":
    main()
