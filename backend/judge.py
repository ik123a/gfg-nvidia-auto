import aiohttp
import os
import re
from dotenv import load_dotenv

load_dotenv()
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")
NVIDIA_API_URL = "https://integrate.api.nvidia.com/v1/chat/completions"

# Judge uses a reliable reasoning model (May 2026)
JUDGE_MODEL = "meta/llama-3.3-70b-instruct"


def strip_markdown(text):
    """Robustly extract C++ code from AI output."""
    if not text or not isinstance(text, str):
        return ""
    code_blocks = re.findall(r'```(?:cpp|c\+\+|c)?\s*(.*?)```', text, re.DOTALL | re.IGNORECASE)
    if code_blocks:
        for block in code_blocks:
            if "class " in block or "void " in block or "int " in block:
                return block.strip()
        return code_blocks[0].strip()
    
    match = re.search(r'(class\s+\w+\s*\{.*?\};)', text, re.DOTALL)
    if match:
        return match.group(1).strip()
    
    code = text.replace("```cpp", "").replace("```c++", "").replace("```c", "").replace("```", "")
    return code.strip()


def remove_comments(text):
    """Remove C++ single-line and multi-line comments."""
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    text = re.sub(r'//.*', '', text)
    text = re.sub(r'\n\s*\n', '\n', text)
    return text.strip()


async def judge_solutions(session, problem_data, results, api_key=None):
    """Deeply inspect and pick the best solution, ensuring NO redefinitions."""
    if not results:
        return ""
    if len(results) == 1:
        return results[0]['code']

    solutions_text = ""
    for i, res in enumerate(results):
        solutions_text += f"\n--- CANDIDATE {i+1} ({res['model']}) ---\n{res['code']}\n"

    # Redefinition Check Guard
    bp = problem_data.get('boilerplate') or ""
    PROMPT_GUARD = "\nCRITICAL: Ensure the picked code DOES NOT redefine 'struct ListNode', 'struct TreeNode', or 'struct Node'. GFG provides these objects globally.\n" if any(s in bp for s in ["ListNode", "TreeNode", "Node "]) else ""

    error_context = f"\nThese solutions were generated to FIX this previous error:\n{problem_data.get('error_text', 'N/A')}" if problem_data.get('error_text') else ""

    prompt = f"""Pick the BEST C++ solution for '{problem_data['title']}'.{PROMPT_GUARD}
{error_context}

PROBLEM: {problem_data['description']}

CANDIDATES:{solutions_text}

Rules:
1. Pick the most correct+efficient solution.
2. Ensure full implementation (no empty bodies).
3. Return ONLY the complete fixed C++ code in a ```cpp block.
4. NO explanations, NO intro/outro text, and NO comments in the code.
5. Use 'using namespace std;' and avoid redundant 'std::' prefixes.
"""

    key = api_key or NVIDIA_API_KEY
    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json"
    }

    if not key or key == "your_nvidia_api_key_here":
        print(f"  [JUDGE] API Key is missing, using first result")
        return results[0]['code'] if results else ""

    payload = {
        "model": JUDGE_MODEL,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0.1,
        "max_tokens": 2048,
        "stream": False,
    }

    try:
        timeout = aiohttp.ClientTimeout(total=30)  # 30s for judge phase
        async with session.post(NVIDIA_API_URL, headers=headers, json=payload, timeout=timeout) as response:
            if response.status == 200:
                result = await response.json()
                final_output = result['choices'][0]['message']['content']
                return remove_comments(strip_markdown(final_output))
            else:
                print(f"  [JUDGE] HTTP {response.status}, falling back to longest result")
                # Fallback to longest valid result
                for r in results:
                    if len(r['code'].splitlines()) > 5:
                        return r['code']
                return results[0]['code']
    except Exception as e:
        print(f"  [JUDGE] Error: {e}, using first result")
        return results[0]['code']
