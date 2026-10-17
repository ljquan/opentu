FROM nginx:stable-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY account/ /usr/share/nginx/html/
EXPOSE 7320
USER 101:101
