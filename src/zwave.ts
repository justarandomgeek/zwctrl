
import ws from "ws";
import { OutgoingMessage, OutgoingResultMessageSuccess, ResultTypes } from '@zwave-js/server/dist/lib/outgoing_message.js';
import { IncomingMessage } from '@zwave-js/server/dist/lib/incoming_message.js';
import { ServerCommand } from "@zwave-js/server/dist/lib/command.js";
import { randomUUID } from "crypto";
import { EndpointCommand } from "@zwave-js/server/dist/lib/endpoint/command.js";




export class ZWaveClient {
  private readonly socket;
  public readonly VersionInfo:Promise<OutgoingMessage & {type:"version"}>;
  public readonly Ready:Promise<void>;

  constructor(address:string) {
    this.socket = new ws(address);

    let gotVersion: (v:OutgoingMessage & {type:"version"})=>void;
    this.VersionInfo = new Promise<OutgoingMessage & {type:"version"}>((resolve)=>{ gotVersion=resolve; });

    this.socket.on("message", (data)=>{
      const msg = JSON.parse(data.toString()) as OutgoingMessage;
      switch (msg.type) {
        case "version":
          gotVersion(msg);
          break;
        case "event":
          this.gotEvent(msg);
          break;
        case "result":
          this.gotResult(msg);
          break;
      }
    });

    
    this.Ready = new Promise<void>((resolve)=>{
      this.socket.once("open", async ()=>{
        await this.sendMessage({
          messageId: "api-schema-id",
          command: ServerCommand.setApiSchema,
          schemaVersion: 5,
        });
        await this.sendMessage({
          messageId: "start-listening-result",
          command: ServerCommand.startListening,
        });
        resolve();
      });
    });
  }

  private waitingMessages = new Map<string, [(v:ResultTypes[keyof ResultTypes])=>void, (v:(OutgoingMessage & {type:"result"; success:false})["errorCode"])=>void]>();
  public async sendMessage(msg:IncomingMessage) : Promise<ResultTypes[keyof ResultTypes]> {
    if (!msg.messageId) {
      msg.messageId = randomUUID();
    }
    return new Promise((resolve, reject)=>{
      this.waitingMessages.set(msg.messageId, [resolve, reject]);
      this.socket.send(
        JSON.stringify(msg)
      );
    });
  }

  private gotResult(msg:OutgoingMessage & {type:"result"}) {
    const waiting = this.waitingMessages.get(msg.messageId);
    if (waiting) {
      this.waitingMessages.delete(msg.messageId);
      const [resolve, reject] = waiting;
      if (msg.success) {
        resolve(msg.result);
      } else {
        reject(msg.errorCode);
      }
    }
  }

  private gotEvent(msg:OutgoingMessage & {type:"event"}) {
    
  }

  public async supportsCCApi(nodeId:number, commandClass:(IncomingMessage&{command:EndpointCommand.invokeCCAPI})["commandClass"]) {
    return (await this.sendMessage({
      messageId: "",
      command: EndpointCommand.supportsCCAPI,
      nodeId: nodeId,
      commandClass: commandClass,
    }) as ResultTypes[EndpointCommand.supportsCCAPI]).supported;
  }

  public async invokeCCApi(nodeId:number, commandClass:(IncomingMessage&{command:EndpointCommand.invokeCCAPI})["commandClass"], methodName:string, ...args:any[]) {
    return (await this.sendMessage({
      messageId: "",
      command: EndpointCommand.invokeCCAPI,
      nodeId: nodeId,
      commandClass: commandClass,
      methodName: methodName,
      args: args,
    })as ResultTypes[EndpointCommand.invokeCCAPI]).response;
  }

  public getNode(nodeId:number) {
    return new Node(this, nodeId);
  }
}

class Node {
  constructor(private readonly client:ZWaveClient, private readonly nodeId:number) {}

  public async invokeCCApi(commandClass:(IncomingMessage&{command:EndpointCommand.invokeCCAPI})["commandClass"], methodName:string, ...args:any[]) {
    return this.client.invokeCCApi(this.nodeId, commandClass, methodName, ...args);
  }

  public async supportsAssoc() {
    return (await Promise.all([
      this.client.supportsCCApi(this.nodeId, 0x85),
      this.client.supportsCCApi(this.nodeId, 0x59),
    ])).reduce((a, b)=>a&&b);
  }

  public async getGroupCount() {
    return await this.invokeCCApi(0x85, "getGroupCount") as Promise<number|undefined>;
  }

  public async getGroup(groupId:number) {
    return this.invokeCCApi(0x85, "getGroup", groupId) as Promise<{ maxNodes: number; nodeIds: readonly number[] } | undefined>;
  }

  async addNodeIds(groupId: number, ...nodeIds: number[]) {
    await this.invokeCCApi(0x85, "addNodeIds", groupId, ...nodeIds);
  }

  async removeNodeIds(options: {groupId?: number; nodeIds?: number[] }) {
    await this.invokeCCApi(0x85, "removeNodeIds", options);
  }


  async getGroupName(groupId: number) {
    return this.invokeCCApi(0x59, "getGroupName", groupId) as Promise<string | undefined>;
  }

  async getGroupInfo(groupId: number, refreshCache: boolean = false) {
    return this.invokeCCApi(0x59, "getGroupInfo", groupId, refreshCache) as Promise<{ mode: number; profile: number; eventCode: number; hasDynamicInfo: boolean } | undefined>;
  }
}