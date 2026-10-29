import {setTimeout as delay} from 'node:timers/promises';
import {randomInt} from 'node:crypto';

export class SendPacing {
  constructor({min=5000,max=13000,pickDelay,now=Date.now,sleep=delay}={}){
    if(!Number.isInteger(min)||!Number.isInteger(max)||min<0||max<min)throw new Error('Invalid send pacing range.');
    Object.assign(this,{min,max,now,sleep});
    this.pickDelay=pickDelay??(profile=>this.defaultDelay(profile));
    this.lastAttempt=null;
  }
  range(from,to){
    const span=this.max-this.min;
    return [Math.round(this.min+span*from),Math.round(this.min+span*to)];
  }
  randomBetween([low,high]){return low===high?low:randomInt(low,high+1);}
  defaultDelay({textLength=0,stickerOnly=false}={}){
    if(stickerOnly)return this.min;
    const length=Number.isFinite(textLength)?Math.max(0,Math.floor(textLength)):0;
    if(length<=10)return this.randomBetween(this.range(0,0.25));
    if(length<=30)return this.randomBetween(this.range(0.125,0.5));
    if(length<=80)return this.randomBetween(this.range(0.375,0.75));
    return this.randomBetween(this.range(0.625,1));
  }
  policy(){
    const band=(maxChars,range)=>({max_chars:maxChars,min_ms:range[0],max_ms:range[1]});
    return {min_ms:this.min,max_ms:this.max,sticker_only_ms:this.min,text_bands:[band(10,this.range(0,0.25)),band(30,this.range(0.125,0.5)),band(80,this.range(0.375,0.75)),band(null,this.range(0.625,1))]};
  }
  async wait(receivedAt,signal,profile={}){
    const started=this.now();
    const interval=this.pickDelay(profile);
    const due=Math.max((receivedAt??started)+interval,this.lastAttempt===null?0:this.lastAttempt+interval);
    while(this.now()<due){await this.sleep(due-this.now(),undefined,{signal});}
    signal?.throwIfAborted();
    this.lastAttempt=this.now();
    return interval;
  }
}
