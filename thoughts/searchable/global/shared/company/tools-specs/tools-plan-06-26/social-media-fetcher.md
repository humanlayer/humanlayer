---
summary: Tool to fetch and format Dexter's Twitter and LinkedIn posts for company updates
last_updated: 2025-06-26
last_updated_by: dex
last_update: Added summary field to frontmatter
---

# Social Media Fetcher Tool Specification

## What problem(s) was I solving?

The weekly and monthly updates frequently include a "What We're Thinking About" section that showcases thought leadership and industry insights. Currently, gathering this content requires manually checking Dexter's Twitter and LinkedIn posts, which is time-consuming and may miss important posts. This tool automates the collection of social media content for inclusion in company updates.

## What user-facing changes did I ship?

A command-line tool that:
1. Fetches recent posts from Dexter's Twitter and LinkedIn profiles
2. Filters posts by date range (e.g., last week, last month)
3. Extracts key thought leadership content
4. Formats posts for easy inclusion in updates
5. Identifies high-engagement posts that resonated with the audience

## How I implemented it

### Core Components

1. **Twitter API Integration**
   - Uses Twitter API v2 to fetch user timeline
   - Retrieves tweets, retweets with comments, and threads
   - Captures engagement metrics (likes, retweets, replies)

2. **LinkedIn API Integration**
   - Uses LinkedIn API to fetch posts and articles
   - Retrieves both short posts and long-form articles
   - Captures engagement metrics (reactions, comments, shares)

3. **Content Parser**
   - Extracts full thread content from Twitter
   - Combines multi-part posts into coherent thoughts
   - Identifies topic themes and categories

4. **Date Range Filter**
   - Configurable time windows (last 7 days, last 30 days, custom range)
   - Timezone-aware date handling

5. **Output Formatter**
   - Markdown format for direct inclusion in updates
   - Optional JSON output for programmatic use
   - Engagement metrics summary

### Usage

```bash
# Fetch last week's posts
tools/social-media-fetcher --days 7

# Fetch posts for specific date range
tools/social-media-fetcher --from 2025-06-01 --to 2025-06-26

# Output as JSON
tools/social-media-fetcher --days 30 --format json

# Include only high-engagement posts (top 20%)
tools/social-media-fetcher --days 7 --high-engagement
```

### Output Format

```markdown
## What We're Thinking About

### Twitter Highlights

**[Date] - [Topic/Theme]**
[Tweet content, including full threads]
*Engagement: X likes, Y retweets*

### LinkedIn Insights

**[Date] - [Article/Post Title]**
[Post excerpt or summary]
[Link to full post]
*Engagement: X reactions, Y comments*
```

## How to verify it

1. **Authentication Test**: Verify API credentials and access
2. **Date Range Test**: Confirm posts are correctly filtered by date
3. **Content Integrity Test**: Ensure full threads/posts are captured
4. **Formatting Test**: Validate markdown output renders correctly
5. **Engagement Test**: Verify metrics are accurately calculated

## Configuration

Requires environment variables:
- `TWITTER_API_KEY`
- `TWITTER_API_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_SECRET`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_ACCESS_TOKEN`

## Edge Cases

1. **Rate Limiting**: Implements exponential backoff for API limits
2. **Private/Deleted Posts**: Gracefully handles unavailable content
3. **Thread Reconstruction**: Properly orders and combines thread posts
4. **Media Handling**: Includes links to images/videos but doesn't embed

## Integration with Update SOPs

This tool directly supports:
- Weekly Update SOP: "What We're Thinking About" section
- Monthly Public Update SOP: Thought leadership content
- Monthly Investor Update SOP: Market observations and insights

## Human Dependencies

### Initial Setup
1. **Twitter API Access**
   - Human needs to create a Twitter Developer Account
   - Generate API credentials (API Key, API Secret, Access Token, Access Secret)
   - Save credentials in `/Users/dex/go/src/github.com/humanlayer/thoughts/.env`:
     ```
     TWITTER_API_KEY=your_api_key_here
     TWITTER_API_SECRET=your_api_secret_here
     TWITTER_ACCESS_TOKEN=your_access_token_here
     TWITTER_ACCESS_SECRET=your_access_secret_here
     ```

2. **LinkedIn API Access**
   - Human needs to create a LinkedIn Developer Application
   - Generate OAuth 2.0 credentials (Client ID, Client Secret)
   - Complete OAuth flow to get Access Token
   - Save credentials in `/Users/dex/go/src/github.com/humanlayer/thoughts/.env`:
     ```
     LINKEDIN_CLIENT_ID=your_client_id_here
     LINKEDIN_CLIENT_SECRET=your_client_secret_here
     LINKEDIN_ACCESS_TOKEN=your_access_token_here
     ```

3. **Account Configuration**
   - Provide Dexter's Twitter handle (@dexhorthy)
   - Provide Dexter's LinkedIn profile URL

### Ongoing Maintenance
- Refresh LinkedIn access token every 60 days
- Monitor API rate limits and upgrade if needed
- Review and approve high-engagement threshold settings

## How It Will Be Used

### By AI During Weekly Updates
```bash
# AI runs this command when preparing weekly updates
tools/social-media-fetcher --days 7 --high-engagement

# Output is automatically inserted into the "What We're Thinking About" section
```

### By AI During Monthly Updates
```bash
# AI runs this for monthly investor/public updates
tools/social-media-fetcher --days 30 --format markdown

# AI curates the best posts for external communication
```

### Integration with Update SOPs
- Weekly Update SOP: Automatically includes thought leadership content
- Monthly Public Update: Provides content for community engagement
- Monthly Investor Update: Shows market insights and company thinking

## GitHub Actions Automation

This tool will be automated via GitHub Actions using cron schedules and launched through headless Claude Code sessions.

### Minimal Permissions Required
- **Repository**: Read all files, write to update documents
- **Secrets**: `TWITTER_API_KEY`, `TWITTER_API_SECRET`, `TWITTER_ACCESS_TOKEN`, `TWITTER_ACCESS_SECRET`, `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `LINKEDIN_ACCESS_TOKEN`, `ANTHROPIC_API_KEY`
- **GitHub Permissions**: Contents (write)

### Example Automation Workflow
```yaml
name: Weekly Social Media Collection
on:
  schedule:
    # Every Friday at 1pm PST (9pm UTC)
    - cron: '0 21 * * 5'
  workflow_dispatch:

jobs:
  collect-social-content:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@v4
      - name: Fetch Social Media Content
        run: |
          claude -p "Run the social-media-fetcher tool to collect Dexter's Twitter and LinkedIn posts from the last 7 days. Focus on high-engagement posts about industry insights, product philosophy, and technical discussions. Format the content for the 'What We're Thinking About' section of the weekly update."
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          TWITTER_API_KEY: ${{ secrets.TWITTER_API_KEY }}
          TWITTER_API_SECRET: ${{ secrets.TWITTER_API_SECRET }}
          TWITTER_ACCESS_TOKEN: ${{ secrets.TWITTER_ACCESS_TOKEN }}
          TWITTER_ACCESS_SECRET: ${{ secrets.TWITTER_ACCESS_SECRET }}
          LINKEDIN_CLIENT_ID: ${{ secrets.LINKEDIN_CLIENT_ID }}
          LINKEDIN_CLIENT_SECRET: ${{ secrets.LINKEDIN_CLIENT_SECRET }}
          LINKEDIN_ACCESS_TOKEN: ${{ secrets.LINKEDIN_ACCESS_TOKEN }}
```

## Future Enhancements

1. Multi-user support (fetch from multiple team members)
2. Sentiment analysis on engagement
3. Topic clustering for theme identification
4. Cross-platform deduplication (same content on both platforms)
5. Integration with blog post detection