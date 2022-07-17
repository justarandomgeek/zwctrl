
import ws from "ws";
import { OutgoingMessage, ResultTypes } from '@zwave-js/server/dist/lib/outgoing_message.js';
import { IncomingMessage } from '@zwave-js/server/dist/lib/incoming_message.js';
import { ServerCommand } from "@zwave-js/server/dist/lib/command.js";
import { randomUUID } from "crypto";
import { EndpointCommand } from "@zwave-js/server/dist/lib/endpoint/command.js";
import { CommandClasses } from "@zwave-js/core";
import { APIMethodsOf } from "zwave-js/build/lib/commandclass/API";




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

  private waitingMessages = new Map<string, [(v:ResultTypes[keyof ResultTypes]|void)=>void, (v:(OutgoingMessage & {type:"result"; success:false})["errorCode"])=>void]>();
  public async sendMessage<T extends IncomingMessage["command"]>(msg:IncomingMessage&{command:T}) : Promise<T extends keyof ResultTypes ? ResultTypes[T] : void> {
    if (!msg.messageId) {
      msg.messageId = randomUUID();
    }
    return new Promise((resolve, reject)=>{
      this.waitingMessages.set(msg.messageId, [resolve as (v:ResultTypes[keyof ResultTypes]|void)=>void, reject]);
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

  public async supportsCCApi(nodeId:number, commandClass:CommandClasses) {
    return (await this.sendMessage({
      messageId: "",
      command: EndpointCommand.supportsCCAPI,
      nodeId: nodeId,
      commandClass: commandClass,
    })).supported;
  }

  public async invokeCCApi<CC extends CommandClasses, TMethod extends (keyof TAPI & string), TAPI extends Record<
      string, (...args: any[]) => any> = CommandClasses extends CC ? any : APIMethodsOf<CC> >
  (nodeId:number, commandClass: CC, methodName: TMethod, ...args: Parameters<TAPI[TMethod]>): Promise<ReturnType<TAPI[TMethod]>> {
    const result = await this.sendMessage({
      messageId: "",
      command: EndpointCommand.invokeCCAPI,
      nodeId: nodeId,
      commandClass: commandClass,
      methodName: methodName,
      args: args,
    });
    return result.response as ReturnType<TAPI[TMethod]>;
  }

  public getNode(nodeId:number) {
    return new Node(this, nodeId);
  }
}

class Node {
  constructor(private readonly client:ZWaveClient, private readonly nodeId:number) {}

  public async invokeCCApi<CC extends CommandClasses, TMethod extends (keyof TAPI & string), 
    TAPI extends Record<string, (...args: any[]) => any> = CommandClasses extends CC ? any : APIMethodsOf<CC> >
  (commandClass: CC, methodName: TMethod, ...args: Parameters<TAPI[TMethod]>): Promise<ReturnType<TAPI[TMethod]>> {
    return this.client.invokeCCApi(this.nodeId, commandClass, methodName, ...args);
  }

  public async supportsAssoc() {
    return (await Promise.all([
      this.client.supportsCCApi(this.nodeId, CommandClasses.Association),
      this.client.supportsCCApi(this.nodeId, CommandClasses["Association Group Information"]),
    ])).reduce((a, b)=>a&&b);
  }

  public async getGroupCount() {
    return this.invokeCCApi(CommandClasses.Association, "getGroupCount");
  }

  public async getGroup(groupId:number) {
    return this.invokeCCApi(CommandClasses.Association, "getGroup", groupId);
  }

  async addNodeIds(groupId: number, ...nodeIds: number[]) {
    await this.invokeCCApi(CommandClasses.Association, "addNodeIds", groupId, ...nodeIds);
  }

  async removeNodeIds(options: {groupId?: number; nodeIds?: number[] }) {
    await this.invokeCCApi(CommandClasses.Association, "removeNodeIds", options);
  }


  async getGroupName(groupId: number) {
    return this.invokeCCApi(CommandClasses["Association Group Information"], "getGroupName", groupId);
  }

  async getGroupInfo(groupId: number, refreshCache: boolean = false) {
    return this.invokeCCApi(CommandClasses["Association Group Information"], "getGroupInfo", groupId, refreshCache);
  }
}