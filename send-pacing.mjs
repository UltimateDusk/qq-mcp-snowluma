import {setTimeout as delay} from 'node:timers/promises';
import {randomInt} from 'node:crypto';

export class SendPacing {
  constructor({min=8000,max=40000,pickDelay,now=Date.now,sleep=delay}={}){
    if(!Number.isInteger(min)||!Number.isInteger(max)||min<0||max<min)throw new Error('Invalid send pacing range.');
    Object.assign(this,{min,max,now,sleep});
    this.pickDelay=pickDelay??(profile=>this.defaultDelay(profile));
    this.lastAttempt=null;this.recent=[];this.lastDetails=null;
  }
  range(from,to){
    const span=this.max-this.min;
    return [Math.round(this.min+span*from),Math.round(this.min+span*to)];
  }
  randomBetween([low,high]){return low===high?low:randomInt(low,high+1);}
  defaultDelay({textLength=0,stickerOnly=false}={}){
    const length=Number.isFinite(textLength)?Math.max(0,Math.floor(textLength)):0;
    if(stickerOnly||length<=10)return this.randomBetween(this.range(0,0.125));
    if(length<=30)return this.randomBetween(this.range(0.0625,0.3125));
    if(length<=80)return this.randomBetween(this.range(0.25,0.625));
    return this.randomBetween(this.range(0.5,1));
  }
  policy(){return {min_ms:this.min,max_ms:this.max,mode:'length_activity_adaptive',consecutive_window_ms:60000,consecutive_penalty_ms:3000,ai_penalty_ms:4000,sticker_base_ms:[this.min,Math.round(this.min+(this.max-this.min)*0.125)]};}
  async wait(receivedAt,signal,profile={}){
    const started=this.now();
    this.recent=this.recent.filter(r=>started-r.at<60000);
    const consecutive=this.recent.filter(r=>r.peer===(profile.peer??'global')).length;
    const base=this.pickDelay(profile);
    const consecutivePenalty=Math.min(9000,consecutive*3000);
    const aiPenalty=Math.min(12000,Math.max(0,(profile.active_ai_count||0)-1)*4000);
    const inferredPenalty=Math.min(8000,(profile.suspected_ai_rounds||0)*2000);
    const interval=Math.min(this.max,Math.max(this.min,base+consecutivePenalty+aiPenalty+inferredPenalty));
    const due=Math.max((receivedAt??started)+interval,this.lastAttempt===null?0:this.lastAttempt+interval);
    if(profile.deadline_at!=null&&due>profile.deadline_at)throw Error('flow_deadline_before_send');
    while(this.now()<due){await this.sleep(due-this.now(),undefined,{signal});}
    signal?.throwIfAborted();
    this.lastAttempt=this.now();this.recent.push({peer:profile.peer??'global',at:this.lastAttempt});
    this.lastDetails={selected_delay_ms:interval,actual_wait_ms:this.lastAttempt-started,received_to_dispatch_ms:receivedAt==null?null:this.lastAttempt-receivedAt,text_length:profile.textLength||0,base_ms:base,consecutive_penalty_ms:consecutivePenalty,ai_activity_penalty_ms:aiPenalty,inferred_ai_penalty_ms:inferredPenalty,reason:['length',...(consecutivePenalty?['recent_send']:[]),...(aiPenalty?['multiple_ai_active']:[]),...(inferredPenalty?['suspected_ai_loop']:[])]};
    return interval;
  }
}
