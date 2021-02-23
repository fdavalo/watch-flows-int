FROM registry.access.redhat.com/ubi8/nodejs-14:latest 
COPY src /opt/app
WORKDIR /opt/app
RUN npm i
USER root
RUN yum install -y net-tools
CMD sh start.sh

FROM registry.access.redhat.com/ubi8/nodejs-14:latest
COPY *.js package.json *.sh /opt/app-root/src
WORKDIR /opt/app-root/src 
RUN npm i
CMD sh start.sh