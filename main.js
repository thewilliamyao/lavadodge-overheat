/**
 * Created by wyao on 2017-01-22.
 */

var game = new Phaser.Game(360, 640, Phaser.AUTO);

var gameOptions = {
    // gameWidth: 600,
    // gameHeight: 1000,
    tileSize: 50,
    fieldSize: {
        rows: 6,
        cols: 6
    }
}

var levels = [
    {
        level:[
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0],
            [0, 0, 0, 0, 0, 0]
        ],
        playerPos: new Phaser.Point(5, 2)
    },
];

var upKey;
var downKey;
var leftKey;
var rightKey;

var olaf;

var olafTween;

var moving = false;

var timer;
var score = 0;
var scoreText;

var GameState = {
    preload: function () {
        this.load.image('background', 'assets/images/Island.png');
        this.load.image('olaf', 'assets/images/olaf.png');
        this.load.image('tile', 'assets/images/Tile.png');
        this.load.image('up', 'assets/images/up.png');
        this.load.image('down', 'assets/images/down.png');
        this.load.image('left', 'assets/images/left.png');
        this.load.image('right', 'assets/images/right.png');
        this.load.image('crack', 'assets/images/crack.png');
        this.load.image('lava', 'assets/images/lava.png');
        this.load.spritesheet("tiles", "assets/images/Tile.png", gameOptions.tileSize, gameOptions.tileSize);
        this.load.audio('sing', 'assets/sounds/sing.mp3');
    },
    create: function () {
        this.background = this.game.add.sprite(0, 0, 'background');
        this.music = game.add.audio('sing');
        this.music.play();
        this.createGame();
    },
    update: function () {
        this.checkOlaf();
        // if (upKey.isDown) {
        //     this.olaf.y = this.olaf.y - 25;
        // }
        // else if (downKey.isDown) {
        //     this.olaf.y = this.olaf.y + 25;
        // }
        //
        // if (leftKey.isDown) {
        //     this.olaf.x--;
        // }
        // else if (rightKey.isDown) {
        //     this.olaf.x++;
        // }

    },

    render: function() {

    },

    createGame: function () {
        this.tilesArray = [];
        this.tileGroup = game.add.group();
        this.crackGroup = game.add.group();
        this.lavaGroup = game.add.group();

        //this.tileGroup.x = (game.width - gameOptions.tileSize * gameOptions.fieldSize.cols) / 2;
        //this.tileGroup.y = (game.height -  gameOptions.tileSize * gameOptions.fieldSize.rows) / 2;
        for (var i = 0; i < gameOptions.fieldSize.rows; i++) {
            this.tilesArray[i] = [];
            for (var j = 0; j < gameOptions.fieldSize.cols; j++) {
                this.addTile(i, j, levels[0].level[i][j]);
            }
        }

        //Create Olaf
        olaf = this.game.add.sprite(gameOptions.tileSize / 2, gameOptions.tileSize / 2, 'olaf');
        //olaf.anchor.setTo(0.5);

        //Create Play Buttons
        this.addPlayButtons();
        this.addKeyboard();

        //Create Enemy
        this.addEnemy();

        //Create Score Counter
        this.addScore();
    },

    addTile: function (row, col, val) {
        var tileXPos = col * gameOptions.tileSize + gameOptions.tileSize / 2;
        var tileYPos = row * gameOptions.tileSize + gameOptions.tileSize / 2;

        var theTile = this.game.add.sprite(tileXPos, tileYPos, "tile");
        //theTile.anchor.setTo(0.5);
        theTile.tileValue = val;
        theTile.tilePosition = new Phaser.Point(col, row);
        this.tilesArray[row][col] = theTile;
        this.tileGroup.add(theTile);
    },

    addPlayButtons: function () {
        this.up = this.game.add.sprite(game.world.centerX, game.world.centerY + 100, 'up');
        this.up.anchor.setTo(0.5);
        this.down = this.game.add.sprite(game.world.centerX, game.world.centerY + 200, 'down');
        this.down.anchor.setTo(0.5);
        this.left = this.game.add.sprite(game.world.centerX - 50, game.world.centerY + 150, 'left');
        this.left.anchor.setTo(0.5);
        this.right = this.game.add.sprite(game.world.centerX + 50, game.world.centerY + 150, 'right');
        this.right.anchor.setTo(0.5);
    },

    addKeyboard: function () {
        olafTween = game.add.tween(olaf);

        upKey = game.input.keyboard.addKey(Phaser.Keyboard.UP);
        downKey = game.input.keyboard.addKey(Phaser.Keyboard.DOWN);
        leftKey = game.input.keyboard.addKey(Phaser.Keyboard.LEFT);
        rightKey = game.input.keyboard.addKey(Phaser.Keyboard.RIGHT);


        upKey.onDown.add(function() {
            if (this.olaf.y > gameOptions.tileSize / 2 && moving == false) {
                console.log(olaf.x + " " + olaf.y);
                olafTween = game.add.tween(olaf).to({
                    y: olaf.y - 50
                }, 40, Phaser.Easing.Linear.None);
                olafTween.start();
                olafTween.onStart.add(function() {
                    moving = true;
                });
                olafTween.onComplete.add(function() {
                    moving = false;
                });
            }
        });
        downKey.onDown.add(function() {
            if (this.olaf.y < gameOptions.tileSize / 2 * 10  && moving == false) {
                console.log(olaf.x + " " + olaf.y);
                olafTween = game.add.tween(olaf).to({
                    y: olaf.y + 50
                }, 40, Phaser.Easing.Linear.None);
                olafTween.start();
                olafTween.onStart.add(function() {
                    moving = true;
                });
                olafTween.onComplete.add(function() {
                    moving = false;
                });
            }

        });
        leftKey.onDown.add(function() {
            if (this.olaf.x > gameOptions.tileSize / 2  && moving == false) {
                console.log(olaf.x + " " + olaf.y);
                olafTween = game.add.tween(olaf).to({
                    x: olaf.x - 50
                }, 40, Phaser.Easing.Linear.None);
                olafTween.start();
                olafTween.onStart.add(function() {
                    moving = true;
                });
                olafTween.onComplete.add(function() {
                    moving = false;
                });
            }
        });
        rightKey.onDown.add(function() {
            if (this.olaf.x < gameOptions.tileSize / 2 * 10  && moving == false) {
                console.log(olaf.x + " " + olaf.y);
                olafTween = game.add.tween(olaf).to({
                    x: olaf.x + 50
                }, 40, Phaser.Easing.Linear.None);
                olafTween.start();
                olafTween.onStart.add(function() {
                    moving = true;
                });
                olafTween.onComplete.add(function() {
                    moving = false;
                });
            }
        });

        olafTween.onStart.add(function() {
            moving = true;
        });

        // key1 = game.input.keyboard.addKey(Phaser.Keyboard.ONE);
        // key2 = game.input.keyboard.addKey(Phaser.Keyboard.ONE);
        // key3 = game.input.keyboard.addKey(Phaser.Keyboard.ONE);
        // key4 = game.input.keyboard.addKey(Phaser.Keyboard.ONE);
    },

    addEnemy: function() {
        game.time.events.loop(Phaser.Timer.SECOND, this.addCrack, this);

        game.time.events.loop(Phaser.Timer.SECOND * 1, function() {
            game.time.events.loop(Phaser.Timer.SECOND, this.addCrack, this);
        }, this);
    },

    addCrack: function() {
        var lavaX = Math.floor((Math.random() * 6) + 1);
        var lavaY = Math.floor((Math.random() * 6) + 1);

        var crack = this.game.add.sprite(lavaX * gameOptions.tileSize, lavaY * gameOptions.tileSize, 'crack');
        crack.anchor.setTo(0.5);
        this.crackGroup.add(crack);

        game.time.events.add(Phaser.Timer.SECOND, function() {
            var lava = this.game.add.sprite(lavaX * gameOptions.tileSize, lavaY * gameOptions.tileSize, 'lava');
            lava.anchor.setTo(0.5);
            this.lavaGroup.add(lava);
            levels[0].level[lavaY - 1][lavaX - 1] = 1;
            crack.destroy();
            game.time.events.add(Phaser.Timer.SECOND * 0.8, function() {
                lava.destroy();
                levels[0].level[lavaY - 1][lavaX - 1] = 0;
            }, this);
        }, this);

    },

    checkOlaf: function() {
        var checkX = Math.floor((olaf.x - gameOptions.tileSize / 2) / gameOptions.tileSize);
        var checkY = Math.floor((olaf.y - gameOptions.tileSize / 2) / gameOptions.tileSize);
        if (levels[0].level[checkY][checkX] == 1){
            console.log("─────────▄▄───────────────────▄▄──");
            console.log("──────────▀█───────────────────▀█─");
            console.log("──────────▄█───────────────────▄█─");
            console.log("──█████████▀───────────█████████▀─");
            console.log("───▄██████▄─────────────▄██████▄──");
            console.log("─▄██▀────▀██▄─────────▄██▀────▀██▄");
            console.log("─██────────██─────────██────────██");
            console.log("─██───██───██─────────██───██───██");
            console.log("─██────────██─────────██────────██");
            console.log("──██▄────▄██───────────██▄────▄██─");
            console.log("───▀██████▀─────────────▀██████▀──");
            console.log("──────────────────────────────────");
            console.log("──────────────────────────────────");
            console.log("──────────────────────────────────");
            console.log("───────────█████████████──────────");
            console.log(" ──────────────────────────────────");
            console.log(" ──────────────────────────────────");
            this.gameOver();
        }
    },

    addScore: function() {
        scoreText = game.add.text(25, 0, 'Score: ' + score, { font:"bold 20px", color: "black"});

        timer = game.time.create(false);
        timer.loop(1000, this.updateScore, this);
        timer.start();
    },

    updateScore: function() {
        score++;
        scoreText.text = 'Score: ' + score;
    },

    gameOver: function() {
        olaf.destroy();
        game.time.events.stop();
        timer.stop();

        scoreText.setStyle({font:"bold 50px", color: "black", align: "center"});
        scoreText.x = game.world.centerX - 100;
        scoreText.y = game.world.centerY - 120;

        this.tileGroup.destroy();
        this.crackGroup.destroy();
        this.lavaGroup.destroy();
        game.gamePaused()
    }
};


game.state.add('GameState', GameState);
game.state.start('GameState');
