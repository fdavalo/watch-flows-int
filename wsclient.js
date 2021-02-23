import websocket from 'websocket';

"use strict";

export class WsClient {
    constructor(resources, handler) {
        this.resources = resources;
        this.handler = handler;
        
        this.clients = {};
        this.clientConnections = {};
        
        for (var res in resources) {
            this.clients[res] = new websocket.client({'name':res});
        }

        for (var res in this.resources) {
            this.clients[res].on('connectFailed', handleError);
            this.clients[res].on('connect', handleConnect);
        }

        this.check();
    }

    handleConnectMessage(name, message) {
        if (message.type === 'utf8') {
            var msg = JSON.parse(message.utf8Data);
            if (msg.request === 'all') {
                for (var uid in msg.data) this.checkResource(name, msg.data[uid]);
            }
            else if (msg.request === 'one') {
                this.checkResource(name, msg.value);
            }
        }
    }

    handleError(name, error) {
        console.log('Connect Error: ' + error.toString());
        this.disconnect();
    }

    handleConnect(connection) {
        var name = connection.config.name;
        console.log('WebSocket Client Connected '+name);
        this.clientConnections[name]=connection;
        this.getResources(name);
        connection.on('error', this.handleError.bind(this, name));
        connection.on('close', this.handleError.bind(this, name));
        connection.on('message', this.handleConnectMessage.bind(this, name));
    }
    
    getResources(res) {
	    var message = {"request":"all"};
	    var json = JSON.stringify(message);
	    if (this.clientConnections[res]) this.clientConnections[res].sendUTF(json);
    }

    disconnect(res) {
	    if (this.clientConnections[res]) {
		    delete this.clientConnections[res];
	    }
    }

    connect(res) {
	    if (this.clientConnections[res]) this.disconnect(res);
	    else this.clients[res].connect(this.resources[res].serverUrl);
    }

    check() {
	    for (var res in this.resources) {
		    if (! this.clientConnections[res]) this.connect(res);
	    }
	    setTimeout(this.check.bind(this), 10000);
    }

    checkResource(type, obj) {
	    if (type=="pods") this.handler.checkPodIP(obj);
	    else if (type=="services") this.handler.checkServiceIP(obj);
    }
}