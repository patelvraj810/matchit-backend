#!/bin/bash

NOTION_API_KEY="${NOTION_API_KEY:-}"
PARENT_ID="${NOTION_PAGE_ID:-326d66dd298b8067a5bbdfce4bab2e88}"
BASE_URL="https://api.notion.com/v1"

if [[ -z "$NOTION_API_KEY" ]]; then
  echo "Missing NOTION_API_KEY environment variable"
  exit 1
fi

# Headers
AUTH_HEADER="Authorization: Bearer ${NOTION_API_KEY}"
NOTION_VERSION="Notion-Version: 2022-06-28"
CONTENT_TYPE="Content-Type: application/json"

# Store created page IDs
declare -A PAGE_IDS

# Function to create a page
create_page() {
    local title="$1"
    local parent_id="$2"
    
    local json_payload=$(cat <<EOF
{
  "parent": { "page_id": "$parent_id" },
  "properties": {
    "title": [
      {
        "text": {
          "content": "$title"
        }
      }
    ]
  }
}
EOF
)
    
    local response=$(curl -s -X POST "${BASE_URL}/pages" \
        -H "$AUTH_HEADER" \
        -H "$NOTION_VERSION" \
        -H "$CONTENT_TYPE" \
        -d "$json_payload")
    
    local page_id=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    echo "$page_id"
}

# Function to create app page with template content
create_app_page() {
    local title="$1"
    local parent_id="$2"
    
    local json_payload=$(cat <<EOF
{
  "parent": { "page_id": "$parent_id" },
  "properties": {
    "title": [
      {
        "text": {
          "content": "$title"
        }
      }
    ]
  }
}
EOF
)
    
    local response=$(curl -s -X POST "${BASE_URL}/pages" \
        -H "$AUTH_HEADER" \
        -H "$NOTION_VERSION" \
        -H "$CONTENT_TYPE" \
        -d "$json_payload")
    
    local page_id=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    
    # Add content blocks
    local blocks_payload=$(cat <<EOF
{
  "children": [
    {
      "object": "block",
      "type": "heading_2",
      "heading_2": {
        "rich_text": [{"type": "text", "text": {"content": "Overview"}}]
      }
    },
    {
      "object": "block",
      "type": "paragraph",
      "paragraph": {
        "rich_text": [{"type": "text", "text": {"content": "[Add product overview]"}}]
      }
    },
    {
      "object": "block",
      "type": "heading_2",
      "heading_2": {
        "rich_text": [{"type": "text", "text": {"content": "Case Study"}}]
      }
    },
    {
      "object": "block",
      "type": "paragraph",
      "paragraph": {
        "rich_text": [{"type": "text", "text": {"content": "[Add case study]"}}]
      }
    },
    {
      "object": "block",
      "type": "heading_2",
      "heading_2": {
        "rich_text": [{"type": "text", "text": {"content": "Market Analysis"}}]
      }
    },
    {
      "object": "block",
      "type": "paragraph",
      "paragraph": {
        "rich_text": [{"type": "text", "text": {"content": "[Add market analysis]"}}]
      }
    },
    {
      "object": "block",
      "type": "heading_2",
      "heading_2": {
        "rich_text": [{"type": "text", "text": {"content": "Revenue Model"}}]
      }
    },
    {
      "object": "block",
      "type": "paragraph",
      "paragraph": {
        "rich_text": [{"type": "text", "text": {"content": "[Add revenue model]"}}]
      }
    },
    {
      "object": "block",
      "type": "heading_2",
      "heading_2": {
        "rich_text": [{"type": "text", "text": {"content": "Technical Architecture"}}]
      }
    },
    {
      "object": "block",
      "type": "paragraph",
      "paragraph": {
        "rich_text": [{"type": "text", "text": {"content": "[Add technical architecture]"}}]
      }
    },
    {
      "object": "block",
      "type": "heading_2",
      "heading_2": {
        "rich_text": [{"type": "text", "text": {"content": "Future Roadmap"}}]
      }
    },
    {
      "object": "block",
      "type": "paragraph",
      "paragraph": {
        "rich_text": [{"type": "text", "text": {"content": "[Add roadmap]"}}]
      }
    },
    {
      "object": "block",
      "type": "heading_2",
      "heading_2": {
        "rich_text": [{"type": "text", "text": {"content": "Funding Requirements"}}]
      }
    },
    {
      "object": "block",
      "type": "paragraph",
      "paragraph": {
        "rich_text": [{"type": "text", "text": {"content": "[Add funding requirements]"}}]
      }
    },
    {
      "object": "block",
      "type": "heading_2",
      "heading_2": {
        "rich_text": [{"type": "text", "text": {"content": "Activity Log"}}]
      }
    },
    {
      "object": "block",
      "type": "paragraph",
      "paragraph": {
        "rich_text": [{"type": "text", "text": {"content": "[Activity updates here]"}}]
      }
    }
  ]
}
EOF
)
    
    curl -s -X PATCH "${BASE_URL}/blocks/${page_id}/children" \
        -H "$AUTH_HEADER" \
        -H "$NOTION_VERSION" \
        -H "$CONTENT_TYPE" \
        -d "$blocks_payload" > /dev/null
    
    echo "$page_id"
}

echo "Creating section pages..."

# Create main sections
PRODUCTS_ID=$(create_page "📱 Products" "$PARENT_ID")
echo "Products: $PRODUCTS_ID"

COMPANY_TOOLS_ID=$(create_page "🛠️ Company Tools" "$PARENT_ID")
echo "Company Tools: $COMPANY_TOOLS_ID"

TRADING_TOOLS_ID=$(create_page "📈 Trading Tools" "$PARENT_ID")
echo "Trading Tools: $TRADING_TOOLS_ID"

RESEARCH_ID=$(create_page "📁 Research" "$PARENT_ID")
echo "Research: $RESEARCH_ID"

sleep 1

echo ""
echo "Creating category pages under Products..."

# Create category pages under Products
ACCESSIBILITY_ID=$(create_page "♿ Accessibility" "$PRODUCTS_ID")
echo "Accessibility: $ACCESSIBILITY_ID"

HEALTHCARE_ID=$(create_page "🏥 Healthcare" "$PRODUCTS_ID")
echo "Healthcare: $HEALTHCARE_ID"

BUSINESS_ID=$(create_page "💼 Business" "$PRODUCTS_ID")
echo "Business: $BUSINESS_ID"

PRODUCTIVITY_ID=$(create_page "⚡ Productivity" "$PRODUCTS_ID")
echo "Productivity: $PRODUCTIVITY_ID"

LIFESTYLE_ID=$(create_page "🌿 Lifestyle" "$PRODUCTS_ID")
echo "Lifestyle: $LIFESTYLE_ID"

FINANCE_ID=$(create_page "💰 Finance" "$PRODUCTS_ID")
echo "Finance: $FINANCE_ID"

CREATOR_ID=$(create_page "🎨 Creator" "$PRODUCTS_ID")
echo "Creator: $CREATOR_ID"

EDUCATION_ID=$(create_page "📚 Education" "$PRODUCTS_ID")
echo "Education: $EDUCATION_ID"

SECURITY_ID=$(create_page "🔒 Security" "$PRODUCTS_ID")
echo "Security: $SECURITY_ID"

FITNESS_ID=$(create_page "💪 Fitness" "$PRODUCTS_ID")
echo "Fitness: $FITNESS_ID"

DESIGN_ID=$(create_page "✏️ Design" "$PRODUCTS_ID")
echo "Design: $DESIGN_ID"

EVENTS_ID=$(create_page "📅 Events" "$PRODUCTS_ID")
echo "Events: $EVENTS_ID"

SMART_HOME_ID=$(create_page "🏠 Smart Home" "$PRODUCTS_ID")
echo "Smart Home: $SMART_HOME_ID"

sleep 1

echo ""
echo "Creating app pages..."

# Accessibility Apps
create_app_page "Accessibility Tools Platform" "$ACCESSIBILITY_ID"
create_app_page "Sign Language Understanding" "$ACCESSIBILITY_ID"

# Healthcare Apps
create_app_page "AI Clinic Receptionist" "$HEALTHCARE_ID"

# Business Apps
create_app_page "MicroAcquire" "$BUSINESS_ID"
create_app_page "No-Show Buster" "$BUSINESS_ID"
create_app_page "PressKit Pro" "$BUSINESS_ID"
create_app_page "Local Barter Network" "$BUSINESS_ID"

# Productivity Apps
create_app_page "Time Audit Detective" "$PRODUCTIVITY_ID"
create_app_page "Agent State Ledger" "$PRODUCTIVITY_ID"
create_app_page "Doc Diet Coach" "$PRODUCTIVITY_ID"
create_app_page "Freelancer Automator" "$PRODUCTIVITY_ID"

# Lifestyle Apps
create_app_page "Mental Health Journal" "$LIFESTYLE_ID"
create_app_page "Boundary Buddy" "$LIFESTYLE_ID"

# Finance Apps
create_app_page "AI Expense Tracker" "$FINANCE_ID"
create_app_page "Career Cost Calculator" "$FINANCE_ID"

# Creator Apps
create_app_page "NewsletterOS" "$CREATOR_ID"

# Education Apps
create_app_page "Language Learning Pop Culture" "$EDUCATION_ID"

# Security Apps
create_app_page "Scam Alert" "$SECURITY_ID"
create_app_page "Unicode Security Scanner" "$SECURITY_ID"

# Fitness Apps
create_app_page "AI Personal Trainer" "$FITNESS_ID"

# Design Apps
create_app_page "AR Interior Designer" "$DESIGN_ID"

# Events Apps
create_app_page "Event Planning Co-Pilot" "$EVENTS_ID"

# Smart Home Apps
create_app_page "Smart Home Energy Monitor" "$SMART_HOME_ID"

# Company Tools
create_app_page "Mission Control" "$COMPANY_TOOLS_ID"

# Trading Tools
create_app_page "Trade Journal" "$TRADING_TOOLS_ID"
create_app_page "ICT Backtesting" "$TRADING_TOOLS_ID"
create_app_page "ICT Alerts" "$TRADING_TOOLS_ID"
create_app_page "ICT Education" "$TRADING_TOOLS_ID"

# Research
create_app_page "King of the North Auction Investigation" "$RESEARCH_ID"

echo ""
echo "✅ Sync complete! Created 4 sections, 13 categories, and 29 app pages."
