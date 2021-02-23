import websocket from 'websocket';
import http from 'http';

"use strict";

export class WsServer {

    constructor(port) {
        this.wsclients = [];
        this.server = http.createServer(function(request, response) {});
        this.server.listen(port, function() {});
        this.wsServer = new websocket.server({httpServer: this.server});
        this.wsServer.on('request', this.wsHandle.bind(this));
    }
    
    // server
    dispatch(key, flows) {
	    var message = {"request":"one", "key":key, "value":flows[key]};
	    var json = JSON.stringify(message);
	    for (var i=0; i < this.wsclients.length; i++) {
		    this.wsclients[i].sendUTF(json);
	    }
    }

    dispatchAll(flows) {
	    var message = {"request":"all", "data":flows};
	    var json = JSON.stringify(message);
	    for (var i=0; i < this.wsclients.length; i++) {
		    this.wsclients[i].sendUTF(json);
	    }
    }

    produce(key, flows) {
	    if (this.wsclients.length>0) this.dispatch(key, flows);
    }

    close(connection) {
        console.log((new Date()) + " Peer " + connection.remoteAddress + " error.");
	    var index = -1;
	    for (var i=0; i < this.wsclients.length; i++) {
		    if (connection==this.wsclients[i]) {
			    index = i;
			    break;
		    }
	    }
	    if (index > 0) this.wsclients.splice(index, 1);
    }

    wsHandleConnection(connection, message) {
        if (message.type === 'utf8') {
            var msg = JSON.parse(message.utf8Data);
            if (msg.request === 'all') {
                connection.sendUTF(JSON.stringify({"request":"all", "data":this.Flows}));
            }
        }
    }

    wsHandle(request) {
	    console.log((new Date()) + ' Connection from origin ' + request.origin + '.');
	    var connection = request.accept(null, request.host);
	    var index = this.wsclients.push(connection) - 1;
	    connection.on('message', this.wsHandleConnection.bind(this, connection));
        connection.on('error', this.close.bind(this));
	    connection.on('close', this.close.bind(this));
    }
}