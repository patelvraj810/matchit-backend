#!/usr/bin/env python3
"""
Notion Sync Script - Syncs OpenClaw workspace to Notion
"""

import os
import requests
from pathlib import Path

# Configuration
NOTION_API_KEY = os.getenv("NOTION_API_KEY", "")
PAGE_ID = os.getenv("NOTION_PAGE_ID", "326d66dd298b8067a5bbdfce4bab2e88")
NOTION_VERSION = "2022-06-28"

if not NOTION_API_KEY:
    raise SystemExit("Missing NOTION_API_KEY environment variable.")

HEADERS = {
    "Authorization": f"Bearer {NOTION_API_KEY}",
    "Content-Type": "application/json",
    "Notion-Version": NOTION_VERSION
}

BASE_URL = "https://api.notion.com/v1"

def make_request(method, endpoint, data=None):
    """Make a request to the Notion API"""
    url = f"{BASE_URL}/{endpoint}"
    try:
        if method == "GET":
            response = requests.get(url, headers=HEADERS)
        elif method == "POST":
            response = requests.post(url, headers=HEADERS, json=data)
        elif method == "PATCH":
            response = requests.patch(url, headers=HEADERS, json=data)
        else:
            return None
        
        if response.status_code in [200, 201]:
            return response.json()
        else:
            print(f"Error {response.status_code}: {response.text[:200]}")
            return None
    except Exception as e:
        print(f"Request error: {e}")
        return None

def get_page(page_id):
    """Get a page by ID"""
    return make_request("GET", f"pages/{page_id}")

def create_page(parent_id, title, content_blocks=None):
    """Create a new page under a parent"""
    data = {
        "parent": {"page_id": parent_id},
        "properties": {
            "title": [{"text": {"content": title}}]
        }
    }
    if content_blocks:
        data["children"] = content_blocks
    return make_request("POST", "pages", data)

def create_database_page(database_id, properties):
    """Create a page in a database"""
    data = {
        "parent": {"database_id": database_id},
        "properties": properties
    }
    return make_request("POST", "pages", data)

def append_blocks(page_id, blocks):
    """Append blocks to a page"""
    data = {"children": blocks}
    return make_request("PATCH", f"blocks/{page_id}/children", data)

def text_to_blocks(text, max_length=2000):
    """Convert text to Notion blocks (handling length limits)"""
    blocks = []
    
    # Split by paragraphs
    paragraphs = text.split('\n\n')
    
    for para in paragraphs:
        if not para.strip():
            continue
        
        # Handle headers
        if para.startswith('# '):
            content = para[2:].strip()[:100]
            blocks.append({
                "type": "heading_1",
                "heading_1": {"rich_text": [{"text": {"content": content}}]}
            })
        elif para.startswith('## '):
            content = para[3:].strip()[:100]
            blocks.append({
                "type": "heading_2",
                "heading_2": {"rich_text": [{"text": {"content": content}}]}
            })
        elif para.startswith('### '):
            content = para[4:].strip()[:100]
            blocks.append({
                "type": "heading_3",
                "heading_3": {"rich_text": [{"text": {"content": content}}]}
            })
        else:
            # Regular paragraph - split if too long
            content = para.strip()
            if len(content) > max_length:
                # Split into chunks
                for i in range(0, len(content), max_length):
                    chunk = content[i:i+max_length]
                    blocks.append({
                        "type": "paragraph",
                        "paragraph": {"rich_text": [{"text": {"content": chunk}}]}
                    })
            else:
                blocks.append({
                    "type": "paragraph",
                    "paragraph": {"rich_text": [{"text": {"content": content}}]}
                })
    
    return blocks

def md_to_blocks(filepath):
    """Read a markdown file and convert to Notion blocks"""
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Truncate if too large (Notion has limits)
        if len(content) > 50000:
            content = content[:50000] + "\n\n... (content truncated)"
        
        return text_to_blocks(content)
    except Exception as e:
        print(f"Error reading {filepath}: {e}")
        return []

def sync_folder_to_notion(parent_id, folder_path, section_name):
    """Sync a folder of markdown files to Notion"""
    print(f"\n📁 Syncing {section_name}...")
    
    # Create section page
    section_page = create_page(parent_id, section_name)
    if not section_page:
        print(f"  ❌ Failed to create {section_name} page")
        return None
    
    section_id = section_page["id"]
    print(f"  ✅ Created/Found {section_name} page: {section_id}")
    
    # Get all markdown files
    folder = Path(os.path.expanduser(folder_path))
    if not folder.exists():
        print(f"  ⚠️ Folder not found: {folder}")
        return section_id
    
    md_files = list(folder.glob("*.md"))
    files_synced = 0
    
    for md_file in md_files:
        filename = md_file.stem
        print(f"  📄 Processing {filename}...")
        
        # Read file content for title
        with open(md_file, 'r', encoding='utf-8') as f:
            first_lines = f.readlines()[:10]
            title = filename.replace('_', ' ')
            for line in first_lines:
                if line.startswith('# '):
                    title = line[2:].strip()
                    break
        
        # Create sub-page
        blocks = md_to_blocks(md_file)
        if blocks:
            sub_page = create_page(section_id, title)
            if sub_page:
                # Append content blocks
                append_blocks(sub_page["id"], blocks[:50])  # Limit blocks
                files_synced += 1
                print(f"    ✅ Synced {filename}")
            else:
                print(f"    ⚠️ Could not create page for {filename}")
        else:
            print(f"    ⚠️ No content for {filename}")
    
    print(f"  📊 {section_name}: {files_synced}/{len(md_files)} files synced")
    return section_id

def sync_products_to_notion(parent_id):
    """Sync products folder structure to Notion"""
    print(f"\n📦 Syncing Products...")
    
    products_path = Path(os.path.expanduser("~/.openclaw/workspace/products"))
    if not products_path.exists():
        print(f"  ❌ Products folder not found")
        return
    
    # Create main Products page
    products_page = create_page(parent_id, "Products Portfolio")
    if not products_page:
        print(f"  ❌ Failed to create Products page")
        return
    
    products_id = products_page["id"]
    print(f"  ✅ Created Products page")
    
    # Categories to sync
    categories = [
        "accessibility", "business", "community", "creator", "design",
        "education", "events", "finance", "fitness", "iot", "lifestyle",
        "productivity", "security"
    ]
    
    total_apps = 0
    
    for category in categories:
        category_path = products_path / category
        if not category_path.exists():
            continue
        
        # Find apps in this category
        apps = [d for d in category_path.iterdir() if d.is_dir() and not d.name.startswith('.')]
        if not apps:
            continue
        
        # Create category page
        cat_page = create_page(products_id, f"{category.title()} Apps")
        if not cat_page:
            continue
        
        print(f"  📂 {category.title()}: {len(apps)} apps")
        
        for app_dir in apps:
            app_name = app_dir.name.replace('-', ' ').title()
            
            # Look for executive summary
            exec_summary = app_dir / "info" / "EXECUTIVE_SUMMARY.md"
            if exec_summary.exists():
                blocks = md_to_blocks(exec_summary)
                if blocks:
                    app_page = create_page(cat_page["id"], app_name)
                    if app_page:
                        append_blocks(app_page["id"], blocks[:30])
                        total_apps += 1
                        print(f"    ✅ {app_name}")
    
    print(f"  📊 Total apps synced: {total_apps}")

def main():
    """Main sync function"""
    print("=" * 60)
    print("🔄 OpenClaw → Notion Sync")
    print(f"📅 {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    # Get root page info
    print(f"\n📄 Root Page ID: {PAGE_ID}")
    root_page = get_page(PAGE_ID)
    if root_page:
        print(f"  ✅ Connected to: {root_page.get('properties', {}).get('title', {}).get('title', [{}])[0].get('text', {}).get('content', 'Unknown')}")
    else:
        print(f"  ⚠️ Could not verify root page, proceeding anyway")
    
    # Sync sections
    sections = [
        ("~/.openclaw/workspace/business", "Business Documents"),
        ("~/.openclaw/workspace/research", "Research Documents"),
    ]
    
    for folder, name in sections:
        sync_folder_to_notion(PAGE_ID, folder, name)
    
    # Sync products separately (has nested structure)
    sync_products_to_notion(PAGE_ID)
    
    # Sync company tools
    company_tools_path = Path(os.path.expanduser("~/.openclaw/workspace/company-tools"))
    if company_tools_path.exists():
        ct_page = create_page(PAGE_ID, "Company Tools")
        if ct_page:
            for tool_dir in company_tools_path.iterdir():
                if tool_dir.is_dir() and not tool_dir.name.startswith('.'):
                    tool_name = tool_dir.name.replace('-', ' ').title()
                    # Find main docs
                    for doc in tool_dir.glob("*.md"):
                        if doc.name != "README.md":
                            blocks = md_to_blocks(doc)
                            if blocks:
                                doc_page = create_page(ct_page["id"], f"{tool_name}: {doc.stem}")
                                if doc_page:
                                    append_blocks(doc_page["id"], blocks[:30])
                                    print(f"  ✅ Company Tools: {tool_name}/{doc.name}")
    
    print("\n" + "=" * 60)
    print("✅ Sync Complete!")
    print(f"🔗 View at: https://notion.so/{PAGE_ID.replace('-', '')}")
    print("=" * 60)

if __name__ == "__main__":
    main()
