#!/bin/bash
while :; do
  ./.simonsays/sync.sh
  echo -e "===SLEEP===\n===SLEEP===\n"; echo 'looping';
  sleep 10;
done
