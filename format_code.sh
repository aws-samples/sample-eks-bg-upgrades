#!/bin/bash

npx prettier --write ./scripts
terraform fmt -recursive ./terraform