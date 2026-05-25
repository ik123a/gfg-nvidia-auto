import os
import aiohttp
import asyncio
import re
from dotenv import load_dotenv

load_dotenv()

NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")
NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

# ============ UPDATED MODELS (MAY 05 2026) ============
# Optimized for SUPREME CODING ACCURACY. Best models first.
MODELS = [
    "meta/llama-3.3-70b-instruct",                 # Best open reasoning model
    "qwen/qwen3-coder-480b-a35b-instruct",        # Massive 480B Coding MoE
    "nvidia/llama-3.3-nemotron-super-49b-v1.5",    # NVIDIA's specialized Nemotron
    "deepseek-ai/deepseek-v4-pro",                 # State-of-the-art reasoning/coding (Experimental)
    "deepseek-ai/deepseek-v4-flash",               # High-speed coding expert (Experimental)
]


def strip_markdown(text):
    """Robustly extract C++ code from AI output."""
    if not text or not isinstance(text, str):
        return ""
    # Try to find fenced code blocks first
    code_blocks = re.findall(r'```(?:cpp|c\+\+|c)?\s*(.*?)```', text, re.DOTALL | re.IGNORECASE)
    if code_blocks:
        # Prefer blocks containing a class or function definition
        for block in code_blocks:
            if "class Solution" in block or "class " in block or "void " in block or "int " in block:
                return block.strip()
        return code_blocks[0].strip()
    
    # Try to find a class definition directly
    match = re.search(r'(class\s+\w+\s*\{.*?\};)', text, re.DOTALL)
    if match:
        return match.group(1).strip()
    
    # Fallback: strip markdown markers
    code = text.replace("```cpp", "").replace("```c++", "").replace("```c", "").replace("```", "")
    return code.strip()


def remove_comments(text):
    """Remove C++ single-line and multi-line comments."""
    # Remove multi-line comments /* ... */
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    # Remove single-line comments // ...
    # Be careful not to remove // inside strings (though unlikely in this context)
    text = re.sub(r'//.*', '', text)
    # Remove excessive blank lines created by comment removal
    text = re.sub(r'\n\s*\n', '\n', text)
    return text.strip()


async def call_model(session, model_name, problem_data, is_fix=False, api_key=None):
    key = api_key or NVIDIA_API_KEY
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }

    if not key or key == "your_nvidia_api_key_here":
        print(f"  [SKIP] NVIDIA API Key is missing. Please configure it in extension settings or .env file.")
        return {"model": model_name, "error": "NVIDIA Key Missing", "success": False}

    # Prevent redefinition of common GFG structs
    bp = problem_data.get('boilerplate') or ""
    PROMPT_GUARD = "\nCRITICAL: Do NOT redefine 'struct ListNode', 'struct TreeNode', 'struct Node', or other types already defined in the problem header. GFG handles these globally.\n" if any(s in bp for s in ["ListNode", "TreeNode", "Node "]) else ""

    if is_fix:
        error_type = "Logic Error (Wrong Answer)" if problem_data.get('is_logic_error') else "Compilation/Runtime Error"
        prompt = f"""Fix this C++ solution for '{problem_data['title']}' ({error_type}).{PROMPT_GUARD}

PROBLEM: {problem_data['description']}

BROKEN CODE:
{problem_data['boilerplate']}

ERROR: {problem_data['error_text']}
"""
        if problem_data.get('is_logic_error'):
            prompt += f"""
FAILING TEST: Input={problem_data.get('input_data','N/A')}, Got={problem_data.get('actual_output','N/A')}, Expected={problem_data.get('expected_output','N/A')}
"""
        prompt += """
Return ONLY the complete fixed C++ class/function. 
CRITICAL: Ensure the function name and parameters EXACTLY match what the driver code/error message expects (e.g., if the error says 'no member named X', you MUST name your function X).
Full logic, no empty bodies. Include #includes if needed. Use 'using namespace std;' and avoid 'std::' prefixes. No explanations. Do NOT include any comments in the code. """
    else:
        prompt = f"""Solve this GeeksforGeeks coding problem in C++.{PROMPT_GUARD}

Problem: {problem_data['title']}
Description: {problem_data['description']}

Template/Signature:
{problem_data['boilerplate']}

Return ONLY the complete C++ class or function with full implementation. Include #includes if needed. Ensure it matches the signature provided. Use 'using namespace std;' and avoid 'std::' prefixes. No explanations. Do NOT include any comments in the code. Optimize for correctness first, then time+space."""

    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.2,
        "max_tokens": 2048,
        "top_p": 0.9,
        "stream": False,
    }

    MAX_RETRIES = 2
    for attempt in range(MAX_RETRIES + 1):
        try:
            timeout = aiohttp.ClientTimeout(total=45)
            async with session.post(NVIDIA_API_URL, headers=headers, json=payload, timeout=timeout) as response:
                if response.status == 200:
                    result = await response.json()
                    message = result.get('choices', [{}])[0].get('message', {})
                    raw_output = message.get('content')
                    
                    if not raw_output:
                        raw_output = message.get('reasoning')
                    
                    if not raw_output:
                        print(f"  [FAIL] {model_name} returned null/empty content and reasoning")
                        return {"model": model_name, "error": "Null AI response", "success": False}
                    
                    clean_code = strip_markdown(raw_output)
                    
                    # Validate response has actual code
                    if "{" in clean_code and "}" in clean_code and len(clean_code.splitlines()) > 3:
                        clean_code = remove_comments(clean_code)
                        print(f"  [OK] {model_name} returned valid code ({len(clean_code)} chars)")
                        return {"model": model_name, "code": clean_code, "success": True}
                    else:
                        return {"model": model_name, "error": "Empty/incomplete solution", "success": False}
                elif response.status == 404 and attempt < MAX_RETRIES:
                    error_body = await response.text()
                    print(f"  [RETRY] {model_name} got 404 (attempt {attempt+1}/{MAX_RETRIES+1}), retrying in 3s...")
                    await asyncio.sleep(3)
                    continue
                else:
                    error_body = await response.text()
                    print(f"  [FAIL] {model_name} HTTP {response.status}: {error_body[:200]}")
                    return {"model": model_name, "error": f"Status {response.status}: {error_body[:100]}", "success": False}
        except asyncio.TimeoutError:
            print(f"  [TIMEOUT] {model_name} timed out after 45s")
            return {"model": model_name, "error": "Timeout (45s)", "success": False}
        except Exception as e:
            error_msg = str(e)[:100]
            print(f"  [ERR] {model_name} exception: {error_msg}")
            return {"model": model_name, "error": error_msg, "success": False}
    
    return {"model": model_name, "error": "All retries exhausted (404)", "success": False}


async def call_model_with_history(session, model_name, problem_data, previous_attempts, api_key=None):
    """
    Enhanced solver that feeds ALL previous failed attempts into the prompt,
    so each subsequent model 'evolves' and avoids past mistakes.
    """
    key = api_key or NVIDIA_API_KEY
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }

    if not key or key == "your_nvidia_api_key_here":
        print(f"  [SKIP] NVIDIA API Key is missing. Please configure it in extension settings or .env file.")
        return {"model": model_name, "error": "NVIDIA Key Missing", "success": False}

    bp = problem_data.get('boilerplate') or ""
    PROMPT_GUARD = "\nCRITICAL: Do NOT redefine 'struct ListNode', 'struct TreeNode', 'struct Node', or other types already defined in the problem header. GFG handles these globally.\n" if any(s in bp for s in ["ListNode", "TreeNode", "Node "]) else ""

    # Build the evolution context from previous attempts
    history_context = ""
    if previous_attempts:
        history_context = "\n\n=== PREVIOUS FAILED ATTEMPTS (LEARN FROM THESE MISTAKES) ===\n"
        for i, attempt in enumerate(previous_attempts):
            history_context += f"\n--- Attempt {i+1} by {attempt.get('model', 'unknown')} ---\n"
            history_context += f"Code:\n{attempt.get('code', 'N/A')}\n"
            history_context += f"Result: {attempt.get('result', 'unknown')}\n"
            if attempt.get('error_text'):
                history_context += f"Error Details: {attempt['error_text']}\n"
            if attempt.get('input_data'):
                history_context += f"Failing Input: {attempt['input_data']}\n"
            if attempt.get('expected_output'):
                history_context += f"Expected Output: {attempt['expected_output']}\n"
            if attempt.get('actual_output'):
                history_context += f"Actual Output: {attempt['actual_output']}\n"
        history_context += "\n=== END OF PREVIOUS ATTEMPTS ===\n"
        history_context += "\nYou MUST produce a DIFFERENT and BETTER solution. Analyze why each previous attempt failed and avoid the same mistakes.\n"

    prompt = f"""Solve this GeeksforGeeks coding problem in C++.{PROMPT_GUARD}

Problem: {problem_data['title']}
Description: {problem_data['description']}

Template/Signature:
{problem_data['boilerplate']}
{history_context}
Return ONLY the complete C++ class or function with full implementation. Include #includes if needed. Use 'using namespace std;' and avoid 'std::' prefixes. No explanations. Do NOT include any comments in the code. Optimize for correctness first, then time+space."""

    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.3 + (0.1 * len(previous_attempts)),  # Increase creativity with more failures
        "max_tokens": 3072,  # More tokens for harder problems
        "top_p": 0.9,
        "stream": False,
    }

    MAX_RETRIES = 2
    for attempt in range(MAX_RETRIES + 1):
        try:
            timeout = aiohttp.ClientTimeout(total=50)  # More time for complex problems
            async with session.post(NVIDIA_API_URL, headers=headers, json=payload, timeout=timeout) as response:
                if response.status == 200:
                    result = await response.json()
                    message = result.get('choices', [{}])[0].get('message', {})
                    raw_output = message.get('content')

                    if not raw_output:
                        raw_output = message.get('reasoning')

                    if not raw_output:
                        print(f"  [FAIL] {model_name} returned null/empty content")
                        return {"model": model_name, "error": "Null AI response", "success": False}

                    clean_code = strip_markdown(raw_output)

                    if "{" in clean_code and "}" in clean_code and len(clean_code.splitlines()) > 3:
                        clean_code = remove_comments(clean_code)
                        print(f"  [OK] {model_name} returned valid code ({len(clean_code)} chars, attempt context: {len(previous_attempts)} prior failures)")
                        return {"model": model_name, "code": clean_code, "success": True}
                    else:
                        return {"model": model_name, "error": "Empty/incomplete solution", "success": False}
                elif response.status == 404 and attempt < MAX_RETRIES:
                    print(f"  [RETRY] {model_name} got 404 (attempt {attempt+1}), retrying in 3s...")
                    await asyncio.sleep(3)
                    continue
                else:
                    error_body = await response.text()
                    print(f"  [FAIL] {model_name} HTTP {response.status}: {error_body[:200]}")
                    return {"model": model_name, "error": f"Status {response.status}: {error_body[:100]}", "success": False}
        except asyncio.TimeoutError:
            print(f"  [TIMEOUT] {model_name} timed out after 50s")
            return {"model": model_name, "error": "Timeout (50s)", "success": False}
        except Exception as e:
            error_msg = str(e)[:100]
            print(f"  [ERR] {model_name} exception: {error_msg}")
            return {"model": model_name, "error": error_msg, "success": False}

    return {"model": model_name, "error": "All retries exhausted (404)", "success": False}


async def get_all_solutions(problem_data):
    async with aiohttp.ClientSession() as session:
        tasks = [call_model(session, model, problem_data) for model in MODELS]
        results = await asyncio.gather(*tasks)
        return results
