FROM registry.access.redhat.com/ubi8/nodejs-14:latest
COPY *.js package.json *.sh /opt/app-root/src
WORKDIR /opt/app-root/src 
RUN npm i
CMD sh start.sh