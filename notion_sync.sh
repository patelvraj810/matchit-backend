#!/bin/bash
# Notion Sync Script - Syncs OpenClaw workspace to Notion using curl

NOTION_API_KEY="${NOTION_API_KEY:-}"
PAGE_ID="${NOTION_PAGE_ID:-326d66dd298b8067a5bbdfce4bab2e88}"
NOTION_VERSION="2022-06-28"

if [[ -z "$NOTION_API_KEY" ]]; then
    echo "❌ Missing NOTION_API_KEY environment variable"
    exit 1
fi

echo "============================================================"
echo "🔄 OpenClaw → Notion Sync"
echo "📅 $(date '+%Y-%m-%d %H:%M:%S')"
echo "============================================================"

# Capitalize first letter
capitalize() {
    echo "$1" | sed 's/\b\(.\)/\u\1/'
}

# Create a page in Notion
create_page() {
    local parent_id="$1"
    local title="$2"
    
    curl -s -X POST "https://api.notion.com/v1/pages" \
        -H "Authorization: Bearer $NOTION_API_KEY" \
        -H "Content-Type: application/json" \
        -H "Notion-Version: $NOTION_VERSION" \
        -d "{
            \"parent\": { \"page_id\": \"$parent_id\" },
            \"properties\": {
                \"title\": [{ \"text\": { \"content\": \"$title\" } }]
            }
        }" | jq -r '.id' 2>/dev/null
}

# Append content to a page
append_to_page() {
    local page_id="$1"
    local content="$2"
    local safe_content="${content:0:1900}"
    
    curl -s -X PATCH "https://api.notion.com/v1/blocks/$page_id/children" \
        -H "Authorization: Bearer $NOTION_API_KEY" \
        -H "Content-Type: application/json" \
        -H "Notion-Version: $NOTION_VERSION" \
        -d "{
            \"children\": [{
                \"type\": \"paragraph\",
                \"paragraph\": {
                    \"rich_text\": [{ \"text\": { \"content\": \"$safe_content\" } }]
                }
            }]
        }"
}

echo ""
echo "📄 Verifying root page..."
curl -s "https://api.notion.com/v1/pages/$PAGE_ID" \
    -H "Authorization: Bearer $NOTION_API_KEY" \
    -H "Notion-Version: $NOTION_VERSION" > /dev/null
echo "  ✅ Connected to Notion page"

echo ""
echo "============================================================"
echo "📦 Syncing Products Portfolio..."
echo "============================================================"

PRODUCTS_DIR="$HOME/.openclaw/workspace/products"
if [[ -d "$PRODUCTS_DIR" ]]; then
    products_page_id=$(create_page "$PAGE_ID" "Products Portfolio")
    echo "  ✅ Created Products Portfolio page: $products_page_id"
    
    # Categories
    for category in accessibility business community creator design education events finance fitness iot lifestyle productivity security; do
        cat_dir="$PRODUCTS_DIR/$category"
        if [[ -d "$cat_dir" ]]; then
            # Count apps
            app_count=$(find "$cat_dir" -maxdepth 1 -type d ! -name "$category" 2>/dev/null | wc -l | tr -d ' ')
            
            if [[ $app_count -gt 0 ]]; then
                cat_name=$(capitalize "$category")
                cat_page_id=$(create_page "$products_page_id" "$cat_name Apps")
                echo "    📂 $cat_name: $app_count apps"
                
                for app_dir in "$cat_dir"/*/; do
                    if [[ -d "$app_dir" ]]; then
                        app_name=$(basename "$app_dir" | sed 's/-/ /g' | sed 's/\b\(.\)/\u\1/g')
                        
                        # Look for EXECUTIVE_SUMMARY.md
                        exec_summary="$app_dir/info/EXECUTIVE_SUMMARY.md"
                        if [[ -f "$exec_summary" ]]; then
                            content=$(head -40 "$exec_summary" | sed 's/"/\\"/g' | tr '\n' ' ')
                            app_page_id=$(create_page "$cat_page_id" "$app_name")
                            echo "      ✅ $app_name"
                            
                            if [[ -n "$app_page_id" ]]; then
                                summary="${content:0:1800}"
                                append_to_page "$app_page_id" "$summary" > /dev/null
                            fi
                        else
                            app_page_id=$(create_page "$cat_page_id" "$app_name")
                            echo "      📄 $app_name (no summary)"
                        fi
                    fi
                done
            fi
        fi
    done
else
    echo "  ⚠️ Products folder not found"
fi

echo ""
echo "============================================================"
echo "🔧 Syncing Company Tools..."
echo "============================================================"

TOOLS_DIR="$HOME/.openclaw/workspace/company-tools"
if [[ -d "$TOOLS_DIR" ]]; then
    tools_page_id=$(create_page "$PAGE_ID" "Company Tools")
    echo "  ✅ Created Company Tools page: $tools_page_id"
    
    for tool_dir in "$TOOLS_DIR"/*/; do
        if [[ -d "$tool_dir" ]]; then
            tool_name=$(basename "$tool_dir" | sed 's/-/ /g' | sed 's/\b\(.\)/\u\1/g')
            
            # Look for key documents
            for doc in "$tool_dir"PROJECT_PLAN.md "$tool_dir"DESIGN_BRIEF.md "$tool_dir"README.md; do
                if [[ -f "$doc" ]]; then
                    doc_name=$(basename "$doc" .md)
                    content=$(head -30 "$doc" | sed 's/"/\\"/g' | tr '\n' ' ')
                    doc_page_id=$(create_page "$tools_page_id" "$tool_name: $doc_name")
                    echo "    📄 $tool_name - $doc_name"
                    
                    if [[ -n "$doc_page_id" ]]; then
                        summary="${content:0:1800}"
                        append_to_page "$doc_page_id" "$summary" > /dev/null
                    fi
                fi
            done
        fi
    done
else
    echo "  ⚠️ Company Tools folder not found"
fi

echo ""
echo "============================================================"
echo "📈 Syncing Trading Tools..."
echo "============================================================"

TRADING_DIR="$HOME/.openclaw/workspace/trading-tools"
if [[ -d "$TRADING_DIR" ]]; then
    trading_page_id=$(create_page "$PAGE_ID" "Trading Tools")
    echo "  ✅ Created Trading Tools page: $trading_page_id"
    
    for tool_dir in "$TRADING_DIR"/*/; do
        if [[ -d "$tool_dir" ]]; then
            tool_name=$(basename "$tool_dir" | sed 's/-/ /g' | sed 's/\b\(.\)/\u\1/g')
            
            # Look for README
            readme="$tool_dir/README.md"
            if [[ -f "$readme" ]]; then
                content=$(head -30 "$readme" | sed 's/"/\\"/g' | tr '\n' ' ')
                doc_page_id=$(create_page "$trading_page_id" "$tool_name")
                echo "    📄 $tool_name"
                
                if [[ -n "$doc_page_id" ]]; then
                    summary="${content:0:1800}"
                    append_to_page "$doc_page_id" "$summary" > /dev/null
                fi
            fi
        fi
    done
else
    echo "  ⚠️ Trading Tools folder not found"
fi

echo ""
echo "============================================================"
echo "✅ Sync Complete!"
echo "🔗 View at: https://notion.so/${PAGE_ID//-/}"
echo "============================================================"
