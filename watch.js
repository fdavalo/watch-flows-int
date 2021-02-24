import fs from 'fs';
import process from 'process';
import readline from 'readline';
import {WsServer} from './wsserver.js';
import {WsClient} from './wsclient.js';
  
"use strict";

export class Watch {

    constructor(port, resources) {
        this.Flows = {};
        this.Pids = {};
        this.Ips = {
            'localhost': {'ip':'localhost', 'type':'node', 'name':'localhost'}
        };
        this.LocalesIps = ['localhost'];
        
        this.wsServer = new WsServer(port, resources);
        new WsClient(resources, this);

        // tcpdump input
        var rl = readline.createInterface({
	        input: process.stdin,
	        output: process.stdout,
	        terminal: false
        });
        this.Lines = [];

        rl.on('line', this.handleLine.bind(this));
    }

    handleLine(line) {
        this.Lines.push(line);

        if (line.startsWith("stop")) this.handleBatch();
        else {
            // launch pid check before batch is handled
            var arr = line.split(' ',4);
            if ((arr[2]!="LISTEN") && (arr[2]!="ESTABLISHED")) return true;
            var pid = arr[3].split("/")[0];
            if (pid == "1") return true;
            if (! (this.Pids[pid] && this.Pids[pid]['ref'].startsWith(arr[3]))) this.getPid(pid);
        }
    }        

    readLinePidCmd(pid, line) {
        var i = line.indexOf("/var/log/pods/");
        if (i>0) {
            var arr1 = line.substring(i+14).split("_", 2);
            if (arr1.length == 2) {
                var namespace = arr1[0];
                var podname = arr1[1];
                this.Pids[pid]['namespace']=namespace;
                this.Pids[pid]['pod']=podname;
                this.Pids[pid]['type']='pod';
                this.Pids[pid]['name']=namespace+".pod."+podname;
            }
        }
    }

    readLinePid(line) {
        var arr = line.split(" ", 4);
        var pid = arr[0];
        var name = arr[1].substring(1,arr[1].length-1);
        var ppid = arr[3];
        if (!this.Pids[pid]) { 
            this.Pids[pid]={'ref':pid+"/"+name, 'type':'node', 'name':this.Ips['localhost']['name']+".process."+name, 'process':name, 'ppid':ppid};
        }
        if (name == "conmon") {
            var readable = fs.createReadStream("/proc/"+pid+"/cmdline");
            var reader = readline.createInterface({ input: readable });
            reader.on('line', this.readLinePidCmd.bind(this, pid));
        }
        else if ((ppid != "1") && (ppid != pid)) {
            this.getPid(ppid);
        }
    }

    getPid(pid) {
	    if (this.Pids[pid]) return true;
	    var readable = fs.createReadStream("/proc/"+pid+"/stat");
	    var reader = readline.createInterface({ input: readable });
	    reader.on('line', this.readLinePid.bind(this));
    }

    checkIp(s, isLocal) {
	    var arr = s.split(":"); //:::17697 127.0.0.1:4180 ::1:42516
	    var port = arr[arr.length-1];
	    var ip = arr[0];
	    if (arr.length>2) ip = 'localhost';
	    var type = 'ip';
	    if ((isLocal) || (ip in this.LocalesIps)) {
		    type = 'node';
		    if (! ip in this.LocalesIps) {
			    if (this.Ips[ip]) this.Ips[ip]['type'] = 'node';
			    else this.Ips[ip] = {'ip':ip, 'type':'node', 'name':ip};
			    this.LocalesIps.push(ip);
		    }
	    }
	    if (! this.Ips[ip]) this.Ips[ip] = {'ip':ip, 'type':type, 'name':ip};
	    return {'ip':ip, 'port':port};
    }

    checkAppIp(ip) {
	    return this.Ips[ip];
    }

    checkPid(pid) {
	    var app = this.Pids[pid];
	    if (app['type'] != 'node') return app;
	    while (true) {
		    if (app['type'] != 'node') break;
		    if (! this.Pids[app['ppid']]) break;
		    app = this.Pids[app['ppid']];
	    }
	    if (app['type'] != 'node') {
		    for (var k in app) {
			    if ((k != 'ref') && (k != 'ppid')) this.Pids[pid][k]=app[k];
		    }
	    }
	    return this.Pids[pid];
    }

    checkApp(app, localPorts) {
	    if (app['name']) return app;
	    if (app['pid']) return this.checkPid(app['pid']);
	    if (localPorts[app['port']]) return this.checkPid(localPorts[app['port']]);
	    return false;
    }

    handleBatch() {
	    var items = [];
	    var start = false;
	    var item;
	    while (true) {
		    var item = this.Lines.shift();
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
		    if ((pid == "1") || (! this.Pids[pid])) continue;
		    var ippl = this.checkIp(arr[0], true);
		    localPorts[ippl['port']]=pid;
		    if (isListening) {
			    listens[ippl['port']] = {'port':ippl['port'], 'pid':pid};
		    }
		    else {
			    var ippd = this.checkIp(arr[1], false);
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
			    if (this.Ips[ippd['ip']]['type']=='node') aflow['ori'] = {'port':ippd['port']};
			    else aflow['ori'] = this.checkAppIp(ippd['ip']);
			    aflow['dest'] = {'pid':pid};
		    }
		    else {
			    aflow['port'] = ippd['port'];
			    aflow['ori'] = {'pid':pid};
			    if (this.Ips[ippd['ip']]['type']=='node') aflow['dest'] = {'port':ippd['port']};
			    else aflow['dest'] = this.checkAppIp(ippd['ip']);
		    }

		    var ori = this.checkApp(aflow['ori'], localPorts);
		    var dest = this.checkApp(aflow['dest'], localPorts);
		    if (ori && dest) {
			    var flowname = ori['name']+"->"+dest['name']+":"+aflow['port'];
			    if (! this.Flows[flowname]) {
				    this.Flows[flowname] = {'ori':ori, 'dest':dest, 'port':aflow['port']};
				    this.wsServer.produce(flowname, this.Flows);
			    }
		    }
	    }
	    var flows = {};
	    var toUpdate = false;
	    for (var key in this.Flows) {
			var ori = this.Flows[key]['ori'];
			var dest = this.Flows[key]['dest'];
			var port = this.Flows[key]['port'];
			var flowname = ori['name']+"->"+dest['name']+":"+port;
			if (key != flowname) toUpdate = true;
			if (! flows[flowname]) flows[flowname] = this.Flows[key];
	    }
	    if (toUpdate) {
		    this.Flows = flows;
	    }
    }

    checkServiceIP(svc) {
	    var ip = svc.spec.clusterIP;
	    if (svc.metadata && svc.spec && ip && (ip != 'None')) {
		    if (! this.Ips[ip]) {
			    this.Ips[ip] = {
				    'ip':ip,
				    'type':'service',
				    'namespace':svc.metadata.namespace,
				    'service':svc.metadata.name,
				    'name':svc.metadata.namespace+".service."+svc.metadata.name
			    };
		    }
		    else {
			    this.Ips[ip]['type'] = 'service';
			    this.Ips[ip]['namespace'] = svc.metadata.namespace;
			    this.Ips[ip]['service'] = svc.metadata.name;
			    this.Ips[ip]['name'] = svc.metadata.namespace+".service."+svc.metadata.name;
		    }
	    }
    }

    checkPodIP(pod) {
	    var ip = pod.status.podIP;
	    if ((pod.status.phase=='Running') &&
		    ((!pod['eventType']) || (pod.eventType != 'DELETED'))) {
		    if (pod.status.podIP == pod.status.hostIP) {
			    for (var i in this.LocalesIps) {
				    var ipl = this.LocalesIps[i];
				    this.Ips[ipl]['name'] = pod.spec.nodeName;
				    this.Ips[ipl]['type'] = 'node';
			    }
			    for (var pid in this.Pids) {
				    if (this.Pids[pid]['type'] == "node") {
					    this.Pids[pid]['name'] = pod.spec.nodeName + ".process." + this.Pids[pid]['process'];
				    }
			    }
		    }
		    else {
			    if (! this.Ips[ip]) {
				    this.Ips[ip] = {
					    'ip':ip,
					    'type':'pod',
					    'namespace':pod.metadata.namespace,
					    'pod':pod.metadata.name,
					    'name':pod.metadata.namespace+".pod."+pod.metadata.name
				    };
			    }
			    else {
				    this.Ips[ip]['type'] = 'pod';
				    this.Ips[ip]['namespace'] = pod.metadata.namespace;
				    this.Ips[ip]['pod'] = pod.metadata.name;
				    this.Ips[ip]['name'] = pod.metadata.namespace+".pod."+pod.metadata.name;
			    }
		    }
	    }
	    //else if (Ips[ip] && (Ips[ip]['name'] === pod.metadata.namespace+".pod."+pod.metadata.name)) {
	    //	delete Ips[ip];
	    //}
    }
}

//echo "" | openssl s_client -showcerts -connect 216.58.213.163:443 2>/dev/null | grep "^subject=" | awk '{print $(NF);}'

