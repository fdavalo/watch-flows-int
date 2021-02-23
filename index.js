import request from 'request';
import JSONStream from 'json-stream';
import fs from 'fs';
import process from 'process';
import websocket from 'websocket';
import http from 'http';
import readline from 'readline';

"use strict";

var webSocketServer = websocket.server;
var WebSocketClient = websocket.client;

var wsclients = [];
var Flows = {};

var webSocketsServerPort = 8080;
var server = http.createServer(function(request, response) {});
var wsServer = null;

var resources = {
	'pods':{'serverUrl':'ws://'+process.env.WATCH_PODS_URL+':80/'},
	'services':{'serverUrl':'ws://'+process.env.WATCH_SERVICES_URL+':80/'}
};

var clients = {};
var clientConnections = {};

for (var res in resources) {
	clients[res] = new WebSocketClient({'name':res});
}

process.on('uncaughtException', function (err) {
  console.log(err);
})

// server
function dispatch(key) {
	var message = {"request":"one", "key":key, "value":Flows[key]};
	var json = JSON.stringify(message);
	for (var i=0; i < wsclients.length; i++) {
		wsclients[i].sendUTF(json);
	}
}

function dispatchAll() {
	var message = {"request":"all", "data":Flows};
	var json = JSON.stringify(message);
	for (var i=0; i < wsclients.length; i++) {
		wsclients[i].sendUTF(json);
	}
}

function produce(key) {
	if (wsclients.length>0) dispatch(key);
}

function close(connection) {
	var index = -1;
	for (var i=0; i < wsclients.length; i++) {
		if (connection==wsclients[i]) {
			index = i;
			break;
		}
	}
	if (index > 0) wsclients.splice(index, 1);
}

function wsHandle(request) {
	console.log((new Date()) + ' Connection from origin ' + request.origin + '.');
	var connection = request.accept(null, request.host);
	var index = wsclients.push(connection) - 1;
	connection.on('message', function(message) {
		if (message.type === 'utf8') {
			var msg = JSON.parse(message.utf8Data);
			if (msg.request === 'all') {
				connection.sendUTF(JSON.stringify({"request":"all", "data":Flows}));
			}
		}
	});
    connection.on('error', function(connection) {
		console.log((new Date()) + " Peer " + connection.remoteAddress + " error.");
		close(connection);
	});
	connection.on('close', function(connection) {
		console.log((new Date()) + " Peer " + connection.remoteAddress + " disconnected.");
		close(connection);
	});
}

function wsStart() {
	server.listen(webSocketsServerPort, function() {});
	wsServer = new webSocketServer({httpServer: server});
	wsServer.on('request', wsHandle);
}

wsStart();

var Pids = {};

function getPid(pid, spid) {
	if (Pids[pid]) return true;
	var readable = fs.createReadStream("/proc/"+pid+"/stat");
	var reader = readline.createInterface({ input: readable });
	reader.on('line', function(line) {
		var arr = line.split(" ", 4);
		var name = arr[1].substring(1,arr[1].length-1);
		var ppid = arr[3];
		if (!Pids[pid]) Pids[pid]={'ref':pid+"/"+name, 'type':'node', 'name':Ips['localhost']['name']+".process."+name, 'process':name, 'ppid':ppid};
		if (name == "conmon") {
			var readable1 = fs.createReadStream("/proc/"+pid+"/cmdline");
			var reader1 = readline.createInterface({ input: readable1 });
			reader1.on('line', function(line) {
				var i = line.indexOf("/var/log/pods/");
				if (i>0) {
					var arr1 = line.substring(i+14).split("_", 2);
					if (arr1.length == 2) {
						var namespace = arr1[0];
						var podname = arr1[1];
						Pids[pid]['namespace']=namespace;
						Pids[pid]['pod']=podname;
						Pids[pid]['type']='pod';
						Pids[pid]['name']=namespace+".pod."+podname;
					}
				}
			});
		}
		else if ((ppid != "1") && (ppid != pid)) {
			getPid(ppid);
		}
	});
}

// tcpdump input
var rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: false
});

var Ips = {
	'localhost': {'ip':'localhost', 'type':'node', 'name':'localhost'}
};

var LocalesIps = ['localhost'];

function checkIp(s, isLocal) {
	var arr = s.split(":"); //:::17697 127.0.0.1:4180 ::1:42516
	var port = arr[arr.length-1];
	var ip = arr[0];
	if (arr.length>2) ip = 'localhost';
	var type = 'ip';
	if ((isLocal) || (ip in LocalesIps)) {
		type = 'node';
		if (! ip in LocalesIps) {
			if (Ips[ip]) Ips[ip]['type'] = 'node';
			else Ips[ip] = {'ip':ip, 'type':'node', 'name':ip};
			LocalesIps.push(ip);
		}
	}
	if (! Ips[ip]) Ips[ip] = {'ip':ip, 'type':type, 'name':ip};
	return {'ip':ip, 'port':port};
}

function checkAppIp(ip) {
	return Ips[ip];
}

function checkPid(pid) {
	var app = Pids[pid];
	if (app['type'] != 'node') return app;
	while (true) {
		if (app['type'] != 'node') break;
		if (! Pids[app['ppid']]) break;
		app = Pids[app['ppid']];
	}
	if (app['type'] != 'node') {
		for (var k in app) {
			if ((k != 'ref') && (k != 'ppid')) Pids[pid][k]=app[k];
		}
	}
	return Pids[pid];
}

function checkApp(app, localPorts) {
	if (app['name']) return app;
	if (app['pid']) return checkPid(app['pid']);
	if (localPorts[app['port']]) return checkPid(localPorts[app['port']]);
	return false;
}

var Lines = [];

rl.on('line', function(line) {
	Lines.push(line);

	if (line.startsWith("stop")) handleBatch();
	else {
		// launch pid check before batch is handled
		var arr = line.split(' ',4);
		if ((arr[2]!="LISTEN") && (arr[2]!="ESTABLISHED")) return true;
		var pid = arr[3].split("/")[0];
		if (pid == "1") return true;
		if (! (Pids[pid] && Pids[pid]['ref'].startsWith(arr[3]))) getPid(pid);
	}
});

function handleBatch() {
	var items = [];
	var start = false;
	var item;
	while (true) {
		var item = Lines.shift();
		if (! item) break;
		if (item.startsWith("stop")) break;
		if (start) items.push(item);
		if (item.startsWith("start")) start = true;
	}
	var listens = {};
	var established = [];
	var localPorts = {};
	for (var i=0; i<items.length; i++) {
		var line = items[i];
		var arr = line.split(' ',4);
		if ((arr[2]!="LISTEN") && (arr[2]!="ESTABLISHED")) continue;
		var isListening = (arr[2]==="LISTEN");
		var pid = arr[3].split("/")[0];
		if ((pid == "1") || (! Pids[pid])) continue;
		var ippl = checkIp(arr[0], true);
		localPorts[ippl['port']]=pid;
		if (isListening) {
			listens[ippl['port']] = {'port':ippl['port'], 'pid':pid};
		}
		else {
			var ippd = checkIp(arr[1], false);
			var aflow = {'ori':ippl, 'dest':ippd, 'pid':pid, 'line':line};
			established.push(aflow);
		}
	}
	for (var i=0; i<established.length; i++) {
		var flow = established[i];
		var ippl = flow['ori'];
		var ippd = flow['dest'];
		var pid = flow['pid'];
		var aflow = {};
		if (listens[ippl['port']]) {
			aflow['port'] = ippl['port'];
			if (Ips[ippd['ip']]['type']=='node') aflow['ori'] = {'port':ippd['port']};
			else aflow['ori'] = checkAppIp(ippd['ip']);
			aflow['dest'] = {'pid':pid};
		}
		else {
			aflow['port'] = ippd['port'];
			aflow['ori'] = {'pid':pid};
			if (Ips[ippd['ip']]['type']=='node') aflow['dest'] = {'port':ippd['port']};
			else aflow['dest'] = checkAppIp(ippd['ip']);
		}

		var ori = checkApp(aflow['ori'], localPorts);
		var dest = checkApp(aflow['dest'], localPorts);
		if (ori && dest) {
			var flowname = ori['name']+"->"+dest['name']+":"+aflow['port'];
			if (! Flows[flowname]) {
				Flows[flowname] = {'ori':ori, 'dest':dest, 'port':aflow['port']};
				produce(flowname);
			}
		}
	}
	var flows = {};
	var toUpdate = false;
	for (var key in Flows) {
			var ori = Flows[key]['ori'];
			var dest = Flows[key]['dest'];
			var port = Flows[key]['port'];
			var flowname = ori['name']+"->"+dest['name']+":"+port;
			if (key != flowname) toUpdate = true;
			if (! flows[flowname]) flows[flowname] = Flows[key];
	}
	if (toUpdate) {
		Flows = flows;
	}
}

// client
function getResources(res) {
	var message = {"request":"all"};
	var json = JSON.stringify(message);
	if (clientConnections[res]) clientConnections[res].sendUTF(json);
}

function handleConnect(connection) {
	var name = connection.config.name;
	console.log('WebSocket Client Connected '+name);
	clientConnections[name]=connection;
	getResources(name);
	connection.on('error', function(error) {
		console.log("Connection Error: " + error.toString());
		disconnect(name);
	});
	connection.on('close', function() {
		console.log('Connection Closed');
		disconnect(name);
	});
	connection.on('message', function(message) {
		if (message.type === 'utf8') {
			var msg = JSON.parse(message.utf8Data);
			if (msg.request === 'all') {
				for (var uid in msg.data) checkResource(name, msg.data[uid]);
			}
			else if (msg.request === 'one') {
				checkResource(name, msg.value);
			}
		}
	});
}

function handleError(error) {
    console.log('Connect Error: ' + error.toString());
}

for (var res in resources) {
	clients[res].on('connectFailed', handleError);
	clients[res].on('connect', handleConnect);
}

function disconnect(res) {
	if (clientConnections[res]) {
		delete clientConnections[res];
	}
}

function connect(res) {
	if (clientConnections[res]) disconnect(res);
	else clients[res].connect(resources[res].serverUrl);
}

function check() {
	for (var res in resources) {
		if (! clientConnections[res]) connect(res);
	}
	setTimeout(check, 10000);
}

check();

function checkResource(type, obj) {
	if (type=="pods") checkPodIP(obj);
	else if (type=="services") checkServiceIP(obj);
}

function checkServiceIP(svc) {
	var ip = svc.spec.clusterIP;
	if (svc.metadata && svc.spec && ip && (ip != 'None')) {
		if (! Ips[ip]) {
			Ips[ip] = {
				'ip':ip,
				'type':'service',
				'namespace':svc.metadata.namespace,
				'service':svc.metadata.name,
				'name':svc.metadata.namespace+".service."+svc.metadata.name
			};
		}
		else {
			Ips[ip]['type'] = 'service';
			Ips[ip]['namespace'] = svc.metadata.namespace;
			Ips[ip]['service'] = svc.metadata.name;
			Ips[ip]['name'] = svc.metadata.namespace+".service."+svc.metadata.name;
		}
	}
}

function checkPodIP(pod) {
	var ip = pod.status.podIP;
	if ((pod.status.phase=='Running') &&
		((!pod['eventType']) || (pod.eventType != 'DELETED'))) {
		if (pod.status.podIP == pod.status.hostIP) {
			for (var i in LocalesIps) {
				var ipl = LocalesIps[i];
				Ips[ipl]['name'] = pod.spec.nodeName;
				Ips[ipl]['type'] = 'node';
			}
			for (var pid in Pids) {
				if (Pids[pid]['type'] == "node") {
					Pids[pid]['name'] = pod.spec.nodeName + ".process." + Pids[pid]['process'];
				}
			}
		}
		else {
			if (! Ips[ip]) {
				Ips[ip] = {
					'ip':ip,
					'type':'pod',
					'namespace':pod.metadata.namespace,
					'pod':pod.metadata.name,
					'name':pod.metadata.namespace+".pod."+pod.metadata.name
				};
			}
			else {
				Ips[ip]['type'] = 'pod';
				Ips[ip]['namespace'] = pod.metadata.namespace;
				Ips[ip]['pod'] = pod.metadata.name;
				Ips[ip]['name'] = pod.metadata.namespace+".pod."+pod.metadata.name;
			}
		}
	}
	//else if (Ips[ip] && (Ips[ip]['name'] === pod.metadata.namespace+".pod."+pod.metadata.name)) {
	//	delete Ips[ip];
	//}
}

//echo "" | openssl s_client -showcerts -connect 216.58.213.163:443 2>/dev/null | grep "^subject=" | awk '{print $(NF);}'

