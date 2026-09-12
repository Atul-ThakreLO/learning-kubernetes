FROM nginx:1.25-alpine

# Remove default nginx site
RUN rm -f /etc/nginx/conf.d/default.conf

# Copy custom nginx config
COPY nginx.conf /etc/nginx/conf.d/taskflow.conf

# Copy static frontend files
COPY index.html style.css app.js /usr/share/nginx/html/

# Non-root: nginx runs as nginx user by default in alpine image
EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
