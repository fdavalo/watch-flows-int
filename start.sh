export FREQ=3
if [[ "$DATA_FREQUENCY" != "" ]]; then export FREQ=$DATA_FREQUENCY; fi
while [[ 1 ]]; do echo "start"; sleep 1; sh data.sh; sleep 1; echo "stop"; sleep $FREQ; done | node index.js

