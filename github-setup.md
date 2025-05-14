# GitHub Repository Setup

To push this code to a GitHub repository under the scope3data organization, follow these steps:

## Option 1: Create repository via GitHub UI

1. Go to https://github.com/organizations/scope3data/repositories/new
2. Create a new repository named "scope3-segments-worker"
3. Do not initialize with a README, .gitignore, or license (we already have these files)
4. After creating the repository, run these commands in your terminal:

```bash
git remote add origin https://github.com/scope3data/scope3-segments-worker.git
git branch -M main
git push -u origin main
```

## Option 2: Create repository via GitHub CLI

If you have GitHub CLI installed, you can create and push to the repository with:

```bash
# Create the repository
gh repo create scope3data/scope3-segments-worker --private --source=. --remote=origin

# Push to the repository
git push -u origin main
```

## After pushing

Once the code is pushed to GitHub:

1. Set up branch protection rules if needed
2. Configure GitHub Actions for CI/CD if desired
3. Add collaborators from the scope3data organization