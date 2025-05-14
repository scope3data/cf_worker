#!/bin/bash
# Script to create and configure HTML cache KV namespace

# Print colorful header
echo -e "\033[1;34m"
echo "========================================"
echo "  Scope3 Segments - HTML Cache Setup    "
echo "========================================"
echo -e "\033[0m"

# Check for wrangler
if ! command -v npx &> /dev/null; then
    echo -e "\033[1;31mError: npx is not installed. Please install Node.js and npm first.\033[0m"
    exit 1
fi

# Validate wrangler.toml exists
if [ ! -f "./wrangler.toml" ]; then
    echo -e "\033[1;31mError: wrangler.toml not found.\033[0m"
    exit 1
fi

# Create the HTML cache KV namespace
echo -e "\033[1;36mCreating HTML_CACHE KV namespace...\033[0m"
HTML_CACHE_RESULT=$(npx wrangler kv namespace create HTML_CACHE)

if [ $? -ne 0 ]; then
    echo -e "\033[1;31mFailed to create HTML_CACHE namespace. Error message:\033[0m"
    echo "$HTML_CACHE_RESULT"
    exit 1
fi

echo "$HTML_CACHE_RESULT"

# Extract the namespace ID from the result
HTML_CACHE_ID=$(echo "$HTML_CACHE_RESULT" | grep -o 'id = "[^"]*' | cut -d'"' -f2)

if [ -z "$HTML_CACHE_ID" ]; then
    echo -e "\033[1;31mFailed to extract HTML_CACHE namespace ID.\033[0m"
    exit 1
fi

echo -e "\033[1;32mHTML_CACHE KV namespace created with ID: $HTML_CACHE_ID\033[0m"

# Update wrangler.toml with the HTML_CACHE ID
echo -e "\033[1;36mUpdating wrangler.toml with the HTML_CACHE namespace ID...\033[0m"

# Find placeholder and replace it with the actual ID
if grep -q "html_cache_placeholder_id" wrangler.toml; then
    sed -i.bak "s/html_cache_placeholder_id/$HTML_CACHE_ID/g" wrangler.toml
    echo -e "\033[1;32mReplaced HTML_CACHE placeholder ID in wrangler.toml\033[0m"
    
    # Clean up backup file
    rm wrangler.toml.bak
else
    echo -e "\033[1;31mCould not find HTML_CACHE placeholder ID in wrangler.toml\033[0m"
    echo "You will need to manually update the HTML_CACHE namespace ID in wrangler.toml:"
    echo "binding = \"HTML_CACHE\""
    echo "id = \"$HTML_CACHE_ID\""
fi

# Create dev namespace for testing
echo -e "\033[1;36mCreating HTML_CACHE_DEV KV namespace for development...\033[0m"
HTML_CACHE_DEV_RESULT=$(npx wrangler kv namespace create HTML_CACHE_DEV)

if [ $? -ne 0 ]; then
    echo -e "\033[1;33mWarning: Failed to create HTML_CACHE_DEV namespace. Using the same namespace for development.\033[0m"
else
    echo "$HTML_CACHE_DEV_RESULT"
    
    # Extract the namespace ID from the result
    HTML_CACHE_DEV_ID=$(echo "$HTML_CACHE_DEV_RESULT" | grep -o 'id = "[^"]*' | cut -d'"' -f2)
    
    if [ -n "$HTML_CACHE_DEV_ID" ]; then
        echo -e "\033[1;32mHTML_CACHE_DEV KV namespace created with ID: $HTML_CACHE_DEV_ID\033[0m"
        echo -e "\033[1;33mYou should consider updating the development environment in wrangler.toml with this ID.\033[0m"
    fi
fi

echo ""
echo -e "\033[1;32mHTML Cache setup complete! You can now use intelligent HTML caching in your worker.\033[0m"
echo ""
echo "Next steps:"
echo "1. Deploy your worker to start using the HTML cache"
echo "2. Add the HTML cache integration to your code (if not already done)"
echo "3. Test the HTML cache functionality"
echo ""
echo "The cached HTML pages will be stored in the HTML_CACHE KV namespace."
echo "They will automatically be refreshed based on origin ETag and Last-Modified headers."