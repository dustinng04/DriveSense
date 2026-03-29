---
name: notion-management
description: Manages Notion pages and databases through the Notion API. Read page metadata, list pages, update content, and manage workspace organization. Use when working with Notion, searching pages, or managing Notion content.
---

# Notion Management

Comprehensive Notion integration enabling page operations, database queries, and content management through the Notion API v1.

## Quick Start

When asked to work with Notion:

1. **Authenticate**: Set up Notion integration token (one-time setup)
2. **Search pages**: Find pages by title or content
3. **Read content**: Fetch page properties and blocks
4. **Update pages**: Modify page properties and content
5. **Query databases**: Search and filter database entries

## Prerequisites

### One-Time Setup

**1. Create Notion Integration:**
```bash
# Visit Notion Integrations page
# https://www.notion.so/my-integrations

# Create new integration
# Give it a name (e.g., "DriveSense")
# Select workspace
# Copy the "Internal Integration Token"
```

**2. Share Pages with Integration:**
```bash
# In Notion, open the page or database you want to access
# Click "Share" button
# Click "Invite"
# Select your integration
# Grant appropriate permissions (Read/Write)
```

**3. Install Dependencies:**
```bash
pip install requests python-dotenv --break-system-packages
```

**4. Initial Authentication:**
```bash
python scripts/authenticate.py
# Paste your integration token when prompted
# Saves token.json for future use
```

## Core Operations

### Search for Pages

**Basic search:**
```bash
python scripts/search_pages.py --query "meeting notes"
```

**Search in database:**
```bash
python scripts/query_database.py --database-id DATABASE_ID --filter "Status equals Done"
```

### Read Page Content

**Get page properties:**
```bash
python scripts/read_page.py --page-id PAGE_ID
```

**Get page blocks (content):**
```bash
python scripts/read_blocks.py --page-id PAGE_ID
```

### Update Pages

**Update page properties:**
```bash
python scripts/update_page.py --page-id PAGE_ID --title "New Title" --status "In Progress"
```

**Append content:**
```bash
python scripts/append_blocks.py --page-id PAGE_ID --content "New paragraph text"
```

## API Rate Limits

**Notion API quotas:**
- **Requests per second:** 3 average
- **Burst limit:** Up to 10 concurrent requests
- **Rate limit:** Exponential backoff on 429 errors

**Best practices:**
- Implement exponential backoff for rate limit errors
- Cache page IDs and metadata when possible
- Use batch operations where supported

## Error Handling

**Common errors:**

```python
# 401 - Unauthorized
# Solution: Check integration token, verify token.json

# 403 - Forbidden
# Solution: Share page/database with integration

# 404 - Not found
# Solution: Verify page/database ID, check if deleted

# 429 - Rate limit exceeded
# Solution: Implement exponential backoff

# 400 - Validation error
# Solution: Check request payload format
```

## Security Best Practices

1. **Never commit credentials:**
   ```bash
   # Add to .gitignore
   token.json
   .env
   notion_token.txt
   ```

2. **Secure token storage:**
   ```bash
   # Set proper permissions
   chmod 600 token.json
   ```

3. **Use minimal permissions:**
   - Only grant Read access if writes aren't needed
   - Share only specific pages/databases, not entire workspace

4. **Rotate tokens regularly:**
   - Generate new integration tokens periodically
   - Revoke old tokens in Notion settings

## OAuth vs Integration Token

**Integration Token (Recommended for MVP):**
- Simpler setup
- No OAuth flow needed
- Good for personal/team use
- Token doesn't expire
- Manual sharing required

**OAuth (Future):**
- Better for public apps
- Users authorize via Notion
- Automatic access to shared content
- Tokens can be refreshed
- More complex implementation

## Integration Examples

### Read page metadata
```python
import requests

headers = {
    "Authorization": f"Bearer {token}",
    "Notion-Version": "2022-06-28"
}

response = requests.get(
    f"https://api.notion.com/v1/pages/{page_id}",
    headers=headers
)
```

### Query database
```python
response = requests.post(
    f"https://api.notion.com/v1/databases/{database_id}/query",
    headers=headers,
    json={"filter": {"property": "Status", "status": {"equals": "Done"}}}
)
```

## Reference Documentation

For detailed information:
- [Notion API Official Docs](https://developers.notion.com/)
- [Notion API Reference](https://developers.notion.com/reference/)
- [Integration Guide](https://developers.notion.com/docs/create-a-notion-integration)
- [Working with Databases](https://developers.notion.com/docs/working-with-databases)
- [Working with Page Content](https://developers.notion.com/docs/working-with-page-content)

## Best Practices

1. **Cache page IDs:** Store IDs locally to avoid repeated searches
2. **Use page properties:** Leverage Notion's property system for metadata
3. **Handle pagination:** Use cursor-based pagination for large result sets
4. **Respect rate limits:** Implement delays and exponential backoff
5. **Version API requests:** Always include Notion-Version header
6. **Test with sandbox:** Create test workspace for development
7. **Error recovery:** Save state before writes for rollback capability
8. **Monitor webhooks:** Use webhooks for real-time updates (future feature)

## Troubleshooting

**"Integration not shared with page"**
```bash
# Go to page in Notion → Share → Invite your integration
```

**"Invalid token"**
```bash
rm token.json
python scripts/authenticate.py
# Paste new token from Notion integrations page
```

**"Object not found"**
- Verify page/database ID is correct
- Check if page was deleted or moved
- Ensure integration has access

**"Rate limited"**
- Reduce request frequency
- Implement exponential backoff
- Check concurrent request count
