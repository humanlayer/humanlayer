FROM node:21-slim

WORKDIR /docs

# Install mintlify globally
RUN npm install -g mintlify

# Copy docs content
COPY . .

# Expose default mintlify port
EXPOSE 3000

# Start mintlify dev server
CMD ["mintlify", "dev"]
