netstat -annp -t | awk '{if (($1!="Proto") && ($7!="-")) print $4" "$5" "$6" "$7;}'
