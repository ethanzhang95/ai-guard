// ez: this is based on the tensorflow plugin example
// Base Init >>
var fs = require('fs');
var config = require('./conf.json')
var dotenv = require('dotenv').config()
var s
const {
  workerData
} = require('worker_threads');
if(workerData && workerData.ok === true){
    try{
        s = require('../pluginWorkerBase.js')(__dirname,config)
    }catch(err){
        console.log(err)
        try{
            s = require('./pluginWorkerBase.js')(__dirname,config)
        }catch(err){
            console.log(err)
            return console.log(config.plug,'WORKER : Plugin start has failed. pluginBase.js was not found.')
        }
    }
}else{
    try{
        s = require('../pluginBase.js')(__dirname,config)
    }catch(err){
        console.log(err)
        try{
            s = require('./pluginBase.js')(__dirname,config)
        }catch(err){
            console.log(err)
            return console.log(config.plug,'Plugin start has failed. pluginBase.js was not found.')
        }
    }
    const {
        haltMessage,
        checkStartTime,
        setStartTime,
    } = require('../pluginCheck.js')
    if(!checkStartTime()){
        console.log(haltMessage,new Date())
        s.disconnectWebSocket()
        return
    }
    setStartTime()
}
// Base Init />>

const ObjectDetectors = require('./ObjectDetectors.js')(config);
var xDis = 60;    //x-distance from center for next line info to be close
var yDis = 60;    //y-distance from center for next line info to be close
var xLen = 320;   //x length of whole video
var yLen = 240;   //y length of whole video
var edgeX = 75;   //how far away from edge x will need to be to consider a case where the swimmer disappears and did not go out of frame.
var edgeY = 50;   //how far away from edge y will need to be to consider a case where the swimmer disappears and did not go out of frame.
var drownTime = 20;    //how many frames a swimmer will need to disappear for in order to consider the swimmer in danger
var panicDistance = 30;     //how far the swimmer will need to move their arms(side to side) or up and down in order for the swimmer to be in danger.
let objects = [];   //each object is an array of frames (frame, x, y, width, height, xMid, yMid, type)
var currFrame = 0;
var flucCountX = 10;
var flucCountY = 10;
s.detectObject = function(buffer,d,tx,frameLocation,callback){
    new ObjectDetectors(buffer).process().then((resp)=>{
        var results = resp.data
        if(results[0]){
			currFrame++;
            var mats = []
            results.forEach(function(v){
                var notNew = false;
                var objectID;
                var type = v.class;
                var xVal = parseFloat(v.bbox[0]);
                var yVal = parseFloat(v.bbox[1]);
                var midX = parseFloat(v.bbox[0]) + (parseFloat(v.bbox[2]) / 2.0);
                var midY = parseFloat(v.bbox[1]) + (parseFloat(v.bbox[3]) / 2.0);
                if(type.trim() != "person"){
                    type = "skipped";
                }
                else{
                    for(let i=0; i<objects.length; i++){
                        if(Math.abs(objects[i][objects[i] .length - 1][6] - midX) <= xDis && xDis && Math.abs(objects[i][objects[i].length - 1][7] - midY) <= yDis){
                            let tempArr = [];
                            tempArr.push(i);
                            tempArr.push(currFrame);
                            tempArr.push(xVal);
                            tempArr.push(yVal);
                            tempArr.push(parseFloat(v.bbox[2]));
                            tempArr.push(parseFloat(v.bbox[3]));
                            tempArr.push(midX);
                            tempArr.push(midY);
                            tempArr.push(type);
                            notNew = true;
                            if(objects[i].length == 75)
                                objects[i].shift();
                            objects[i].push(tempArr);
                            break;
                        }
                    }
                    if(notNew == false){
                        let temp = [];
                        temp.push(objects.length);
                        temp.push(currFrame);
                        temp.push(xVal);
                        temp.push(yVal);
                        temp.push(parseFloat(v.bbox[2]));
                        temp.push(parseFloat(v.bbox[3]));
                        temp.push(midX);
                        temp.push(midY);
                        temp.push(type);
                        let a = [];
                        a.push(temp);
                        objectID = objects.length;
                        objects.push(a);
                    }
                }
                plugLog(objects)
                mats.push({
                    x: v.bbox[0],
                    y: v.bbox[1],
                    width: v.bbox[2],
                    height: v.bbox[3],
                    tag: objectID,
                    confidence: v.score,
				})
                //DROWNING DETECTION HERE
                for(let i=0; i<objects.length; i++){    //check for long disappearences that are not off the edge
                    if(objects[i].length < 20){
                        continue;
                    }
                    if(currFrame - objects[i][objects[i].length - 1][1] > drownTime){    // long dissappearence   
                        if(objects[i][objects[i].length - 1][2] > edgeX && objects[i][objects[i].length - 1][2] < (xLen - edgeX) && objects[i][objects[i].length-1][3] > edgeY && objects[i][objects[i].length - 1][3] < (yLen - edgeY)){ 
                            plugLog("Object " + i + " could be in Danger!")  //checking if object did not go out the edge
                        }
                    }
                }

                //check for fluctuations in x and y
                for(let i=0; i<objects.length; i++){
                    if(objects[i].length < 10){
                        continue;
                    }
                    previousFrame = objects[i][0][1];
                    previousX = objects[i][0][2];
                    previousY = objects[i][0][3];
                    previousW = objects[i][0][4];
                    previousH = objects[i][0][5];
                    var flucY = true;
                    var flucX = true;
                    var xDiff = false;
                    var yDiff = false;
                    var xCount = 0;
                    var yCount = 0;
                    if(previousW < objects[i][1][4]){
                        xDiff = false;
                    }
                    else{
                        xDiff = true;
                    }
                    if(previousH < objects[i][1][5]){
                        yDiff = false;
                    }
                    else{
                        yDiff = true;
                    }
                    for(let j=1; j<objects[i].length; j++){
                        if(objects[i][j][1] - objects[i][j-1][1] > drownTime){   //if no detection for long time, previous case would already be covered
                            flucX = false;
                            flucY = false;
                            break;
                        }
            
                        if(xDiff == false){
                            if(objects[i][j][4] - objects[i][j-1][4] >= panicDistance){
                                xDiff = true;
                                xCount++;
                            }
                        }
                        else{
                            if(objects[i][j-1][4] - objects[i][j][4] >= panicDistance){
                                xDiff = false;
                                xCount++;
                            }
                        }
                        if(yDiff == false){
                            if(objects[i][j][5] - objects[i][j-1][5] >= panicDistance){
                                yDiff = true;
                                yCount++;
                            }
                        }
                        else{
                            if(objects[i][j-1][5] - objects[i][j][5] >= panicDistance){
                                yDiff = false;
                                yCount++;
                            }
                        }
                    }
                    if((flucX != false && fluxY != false)){
                        if(xCount > flucCountX || yCount > flucCountY){
                            plugLog("Object " + i + " could be in Danger!")
                        }
                    }
                    
                }




            })
            var isObjectDetectionSeparate = d.mon.detector_pam === '1' && d.mon.detector_use_detect_object === '1'
            var width = parseFloat(isObjectDetectionSeparate  && d.mon.detector_scale_y_object ? d.mon.detector_scale_y_object : d.mon.detector_scale_y)
            var height = parseFloat(isObjectDetectionSeparate  && d.mon.detector_scale_x_object ? d.mon.detector_scale_x_object : d.mon.detector_scale_x)
            tx({
                f:'trigger',
                id:d.id,
                ke:d.ke,
                details:{
                    plug:config.plug,
                    name:'Tensorflow',
                    reason:'object',
                    matrices:mats,
                    imgHeight:width,
                    imgWidth:height,
                    time: resp.time
                }
            })
        }
        callback()
    })
}
