FROM gitpod/workspace-full:latest

# Install Node.js 20.15.1 and pnpm 9.4.0 as specified in .tool-versions
USER gitpod

# Update Node.js version
RUN bash -c ". .nvm/nvm.sh && nvm install 20.15.1 && nvm use 20.15.1 && nvm alias default 20.15.1"

# Install pnpm globally
RUN bash -c ". .nvm/nvm.sh && nvm use 20.15.1 && npm install -g pnpm@9.4.0"

# Install wrangler CLI for Cloudflare deployment if needed
RUN bash -c ". .nvm/nvm.sh && nvm use 20.15.1 && npm install -g wrangler"

# Set default node version in PATH
RUN echo ". ~/.nvm/nvm.sh && nvm use 20.15.1" >> ~/.bashrc