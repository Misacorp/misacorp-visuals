 $(document).ready(function(){
      $('.parallax').parallax();
      $(".button-collapse").sideNav();
      getDistance();
    });

function getDistance() {
    
    var mX, mY, distance,
        $element = $('#main-logo');

    function calculateDistance(elem, mouseX, mouseY) {
        return Math.floor(Math.sqrt(Math.pow(mouseX - (elem.offset().left+(elem.width()/2)), 2) + Math.pow(mouseY - (elem.offset().top+(elem.height()/2)), 2)));
    }

    $('.header-container').mousemove(function(e) {  
        mX = e.pageX;
        mY = e.pageY;
        distance = calculateDistance($element, mX, mY);
        $("#header-circle").css({"width" : 2 * distance + "px", "height" :  2 * distance + "px"})
    });

};