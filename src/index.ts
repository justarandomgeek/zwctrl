#!/usr/bin/env node

import { program } from 'commander';
import { pipeline } from 'stream';
import { promisify } from 'util';
const pipelineAsync = promisify(pipeline);
import { ZWaveClient } from './zwave.js';

async function fromAsync<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const x of gen) {
    out.push(x);
  }
  return out;
}

type ProgramOptions = {

};

async function prepareZWaveClient() {
  const client = new ZWaveClient("ws://home.jarg.io:3333");
  const version = await client.VersionInfo;
  console.log(`server ${version.serverVersion} driver ${version.driverVersion} home ${version.homeId}`);
  await client.Ready;
  console.log(`ready...`);
  return client;
}


program
  .version('0.0.1')
  .description("");

const group = program.command("group");
group.command("list <nodeId>")
  .action(async (nodeId:string)=>{
    const client = await prepareZWaveClient();
    const node = client.getNode(Number(nodeId));
    const count = await node.getGroupCount();
    if (!count) {
      console.log(`No groups`);
      return;
    } else {
      console.log(`Node ${nodeId} has ${count} groups`);
    }
    for (let i = 1; i <= count; i++) {
      const group = await node.getGroup(i);
      console.log(`Group ${i}: ${await node.getGroupName(i)} ${group?.nodeIds.length}/${group?.maxNodes} [${group?.nodeIds}]`);
    }
  });

group.command("add <nodeId> <groupId> <otherIds...>")
  .action(async (nodeId:string, groupId:string, otherIds:string[])=>{
    const client = await prepareZWaveClient();
    const node = client.getNode(Number(nodeId));
    await node.addNodeIds(Number(groupId), ...otherIds.map(v=>Number(v)));
    console.log("ok");
  });

group.command("remove <nodeId> <groupId> <otherIds...>")
  .action(async (nodeId:string, groupId:string, otherIds:string[])=>{
    const client = await prepareZWaveClient();
    const node = client.getNode(Number(nodeId));
    await node.removeNodeIds({groupId: Number(groupId), nodeIds: otherIds.map(v=>Number(v))});
    console.log("ok");
  });

await program.parseAsync();
process.exit();