#!/bin/bash
# Script to deploy the Scope3 Segments Worker in route handler mode

# Print colorful header
echo -e "\033[1;34m"
echo "=========================================="
echo "  Scope3 Segments Worker - Route Deploy  "
echo "=========================================="
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

# Check for route configuration
if ! grep -q "env.routes.routes" wrangler.toml; then
    echo -e "\033[1;33mWarning: No route configuration found in wrangler.toml.\033[0m"
    echo "Please configure your routes before deployment:"
    echo ""
    echo '[env.routes.routes]'
    echo 'pattern = "yourdomain.com/*"'
    echo 'zone_name = "yourdomain.com"'
    echo ""
    read -p "Do you want to continue anyway? (y/n) " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Deploy the worker in routes mode
echo -e "\033[1;36mDeploying worker in route handler mode...\033[0m"
npx wrangler deploy --env routes

# Check if deployment was successful
if [ $? -eq 0 ]; then
    echo -e "\033[1;32mWorker deployment successful!\033[0m"
    echo ""
    echo "Next steps:"
    echo "1. Go to your Cloudflare dashboard"
    echo "2. Configure Workers Routes for your domain"
    echo "3. Test by visiting your domain directly"
    echo ""
    echo "For more information, see DEPLOYMENT.md and ROUTE_HANDLER_TESTING.md"
else
    echo -e "\033[1;31mWorker deployment failed.\033[0m"
    echo "Check the error message above for details."
fi