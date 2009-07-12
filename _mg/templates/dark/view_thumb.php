	<div id="cats">
        <ul>
		    <?php categories(); ?>
	    </ul>
	</div>
	<h1><?php gallery_name('link') ?> | last update <?php last_update_date('m.d.y') ?> | <?php last_update_time() ?></h1>
	<div id="nav">
		<ul>
			<? thumbnail_nav('6', '6', '&ndash;', '<li>|</li>'); ?></li><li>|</li><?php view_switcher('list', 'thumbs', 'file'); ?>
		</ul>
	</div>	
	<div id="thumb" class="view">
	    <? thumbnail_table('6', '6'); ?>
	</div>
	<div id="styles">
	   <ul><li>styles:</li><?php style_switcher(); ?></ul>
	</div>
	<div id="footer">
		<?php mg_powered(); ?> &mdash; <?php validation(); ?> &mdash; if it looks weird in your browser, get a <a href="http://www.mozilla.org/products/firefox/" title="Take back the web with Firefox"><span>better one</span></a>
	</div>