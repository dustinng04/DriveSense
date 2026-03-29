#!/usr/bin/env python3
"""
Notion Integration Authentication Script

This script helps set up Notion API authentication by:
1. Accepting an integration token
2. Validating the token by making a test API call
3. Storing the token securely in token.json

Prerequisites:
- Create a Notion integration at https://www.notion.so/my-integrations
- Copy the "Internal Integration Token"
- Share at least one page/database with your integration

Usage:
    python authenticate.py
"""

import json
import os
import sys
from pathlib import Path

try:
    import requests
except ImportError:
    print("Error: 'requests' package not installed")
    print("Install with: pip install requests --break-system-packages")
    sys.exit(1)

NOTION_API_VERSION = "2022-06-28"
NOTION_API_BASE = "https://api.notion.com/v1"
TOKEN_FILE = Path(__file__).parent / "token.json"


def validate_token(token: str) -> dict:
    """
    Validate the Notion integration token by fetching user info
    
    Args:
        token: The Notion integration token to validate
        
    Returns:
        dict: User/bot information if successful
        
    Raises:
        requests.RequestException: If validation fails
    """
    headers = {
        "Authorization": f"Bearer {token}",
        "Notion-Version": NOTION_API_VERSION,
    }
    
    print("Validating token...")
    response = requests.get(
        f"{NOTION_API_BASE}/users/me",
        headers=headers,
        timeout=10
    )
    
    if response.status_code == 200:
        return response.json()
    elif response.status_code == 401:
        raise ValueError("Invalid token - authentication failed")
    elif response.status_code == 403:
        raise ValueError("Token valid but lacks necessary permissions")
    else:
        raise ValueError(f"API error: {response.status_code} - {response.text}")


def save_token(token: str, user_info: dict) -> None:
    """
    Save the validated token to token.json
    
    Args:
        token: The validated Notion integration token
        user_info: User/bot information from Notion API
    """
    token_data = {
        "token": token,
        "notion_version": NOTION_API_VERSION,
        "user": {
            "type": user_info.get("type"),
            "name": user_info.get("name"),
            "id": user_info.get("id"),
        },
        "workspace": user_info.get("workspace_name"),
    }
    
    with open(TOKEN_FILE, "w") as f:
        json.dump(token_data, f, indent=2)
    
    os.chmod(TOKEN_FILE, 0o600)
    print(f"\n✓ Token saved to: {TOKEN_FILE}")


def load_existing_token() -> dict | None:
    """
    Load existing token from token.json if it exists
    
    Returns:
        dict: Token data if file exists, None otherwise
    """
    if TOKEN_FILE.exists():
        try:
            with open(TOKEN_FILE) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return None
    return None


def main():
    """Main authentication flow"""
    print("=" * 60)
    print("Notion Integration Authentication")
    print("=" * 60)
    
    existing_token = load_existing_token()
    if existing_token:
        print(f"\nExisting token found for: {existing_token.get('user', {}).get('name')}")
        response = input("Do you want to replace it? (y/n): ").strip().lower()
        if response != 'y':
            print("Keeping existing token.")
            return
    
    print("\nTo get your Notion integration token:")
    print("1. Go to https://www.notion.so/my-integrations")
    print("2. Click 'New integration'")
    print("3. Give it a name (e.g., 'DriveSense')")
    print("4. Select your workspace")
    print("5. Copy the 'Internal Integration Token'")
    print("\nIMPORTANT: You must share pages/databases with your integration")
    print("(Click Share → Invite → Select your integration)")
    print()
    
    token = input("Paste your integration token: ").strip()
    
    if not token:
        print("Error: No token provided")
        sys.exit(1)
    
    if not token.startswith("secret_"):
        print("Warning: Token doesn't start with 'secret_' - this may not be valid")
        response = input("Continue anyway? (y/n): ").strip().lower()
        if response != 'y':
            sys.exit(1)
    
    try:
        user_info = validate_token(token)
        
        print("\n✓ Token is valid!")
        print(f"  Type: {user_info.get('type')}")
        print(f"  Name: {user_info.get('name')}")
        print(f"  ID: {user_info.get('id')}")
        
        save_token(token, user_info)
        
        print("\n" + "=" * 60)
        print("Authentication successful!")
        print("=" * 60)
        print("\nNext steps:")
        print("1. Share pages/databases with your integration")
        print("2. Use scripts to interact with Notion API")
        print("3. Check SKILL.md for available operations")
        
    except ValueError as e:
        print(f"\n✗ Error: {e}")
        sys.exit(1)
    except requests.RequestException as e:
        print(f"\n✗ Network error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
