import process from 'process';
import {Watch} from './watch.js';

"use strict";

process.on('uncaughtException', function (err) {
	console.log(err);
});
  
var resources = {
	'pods':{'serverUrl':'ws://'+process.env.WATCH_PODS_URL+':80/'},
	'services':{'serverUrl':'ws://'+process.env.WATCH_SERVICES_URL+':80/'}
};

new Watch(process.env.PORT, resources);


