#!/bin/sh
#
# Setup Git hooks for the project
# This script creates symbolic links from the Git hooks directory to the project's hooks directory

# Set hook directory paths
GIT_HOOKS_DIR=".git/hooks"
PROJECT_HOOKS_DIR=".hooks"

# Create symbolic links for each hook in the project hooks directory
for hook in "$PROJECT_HOOKS_DIR"/*; do
  if [ -f "$hook" ]; then
    hook_name=$(basename "$hook")
    echo "Setting up $hook_name hook..."
    # Remove existing hook if it exists
    if [ -f "$GIT_HOOKS_DIR/$hook_name" ]; then
      rm "$GIT_HOOKS_DIR/$hook_name"
    fi
    # Create symbolic link
    ln -s "../../$PROJECT_HOOKS_DIR/$hook_name" "$GIT_HOOKS_DIR/$hook_name"
    chmod +x "$GIT_HOOKS_DIR/$hook_name"
    echo "✅ $hook_name hook installed successfully"
  fi
done

echo "Git hooks setup complete!"