/*
    © 2017 Savoir-faire Linux <https://savoirfairelinux.com>
    License LGPL-3.0 or later (http://www.gnu.org/licenses/LGPL.html).
*/
odoo.define('project_invoicing.project_widget', function (require) {
"use strict";

var common = require('web.form_common');
var core = require('web.core');
var data = require('web.data');
var data_manager = require('web.data_manager');
var form_relational_widgets = require('web.form_relational');
var Model = require('web.DataModel');
var ViewManager = require('web.ViewManager');
var ControlPanel = require('web.ControlPanel');
var utils = require('web.utils');
var ListView = require('web.ListView');
var session = require('web.session');
var CrashManager = require('web.CrashManager');

var QWeb = core.qweb;
var _t = core._t;

var InvoicePrepareFieldManager = common.DefaultFieldManager.extend({
    init: function(parent) {
        this._super(arguments);
        this.options = {};
        this.parent = parent;
    },
    get_fields_values: function(){
        return {};
    },
    do_action: function(){
        this.parent.do_action.apply(this.parent, arguments);
    },
});


var InvoicePrepareGroupType = ListView.Groups.extend({
    /*
        The list group is simlpified so that child rows are not
        refreshed when opening/closing the group.
    */
    init: function() {
        this._super.apply(this, arguments);
        this.rendered = false;
    },
    open: function () {
        if(!this.rendered){
            this._super.apply(this, arguments);
            this.rendered = true;
        }
        else {
            $(this.elements).show();
        }
    },
    close: function () {
        $(this.elements).hide();
    },
    on_records_reset: function () {},
})


var InvoicePrepareListType = ListView.List.extend({
    /*
        The checkbox on a row is disabled if the analytic line is already invoiced
        or is not invoiceable.
    */
    init: function() {
        this._super.apply(this, arguments);
        this.records.unbind('change');
        var self = this;
        this.records.bind('change', function (event, record, attribute, value, old_value) {
            var $row;
            if (attribute === 'id') {
                if (old_value) {
                    throw new Error(
                        _.str.sprintf( _t("Setting 'id' attribute on existing record %s"),
                        JSON.stringify(record.attributes) ));
                }
                self.dataset.add_ids([value], self.records.indexOf(record));
                $row = self.$current.children('[data-id=false]');
            } else {
                $row = self.$current.children('[data-id=' + record.get('id') + ']');
            }
            var $newRow = $(self.render_record(record));

            // This part was changed from the source code
            var checkbox = $newRow.find('.o_list_record_selector input');
            if(record.attributes.invoicing_state !== 'to_invoice'){
                checkbox.prop('disabled', true);
            }
            else{
                checkbox.prop('checked', !!$row.find('.o_list_record_selector input').prop('checked'));
            }

            $row.replaceWith($newRow);
        });
    },
    render: function () {
        this.records.records.forEach(function(record){
            if(record.attributes.invoicing_state === 'to_invoice') {
                record.attributes.final_price = record.attributes.sale_price;
            }
        });
        this._super.apply(this, arguments);
        var self = this;
        this.records.records.forEach(function(record){
            if(record.attributes.invoicing_state !== 'to_invoice') {
                var $row = self.$current.children('[data-id=' + record.attributes.id + ']');
                $row.find('.o_list_record_selector input').prop('disabled', true);
            }
        });
    },
})


var InvoicePrepareListView = core.one2many_view_registry.get('list').extend({
    init: function(){
        this._super.apply(this, arguments);
        this.options.GroupsType = InvoicePrepareGroupType;
        this.options.ListType = InvoicePrepareListType;
    },
    load_list: function() {
        var res = this._super.apply(this, arguments);

        var self = this;
        this.$('thead .o_list_record_selector input').unbind('click').click(function() {
            self.$('tbody .o_list_record_selector input').filter(function(){
                return !$(this).prop('disabled');
            }).prop('checked', $(this).prop('checked'));
            var selection = self.groups.get_selection();
            $(self.groups).trigger('selected', [selection.ids, selection.records]);
        });

        return res;
    },
    editable: function () {
        // Allow edition of the line in grouped mode
        return true;
    },
});


var X2ManyViewManager = ViewManager.extend({
    /*
        Copied from web/static/js/views/form_relational_widgets.js
        The reason is that is is defined in that file as a private variable.
    */
    custom_events: {
        'scrollTo': function() {},
    },
    init: function(parent, dataset, views, flags, x2many_views) {
        flags = _.extend({}, flags, {
            headless: false,
            search_view: false,
            action_buttons: true,
            pager: true,
            sidebar: false,
        });
        this.control_panel = new ControlPanel(parent, "X2ManyControlPanel");
        this.set_cp_bus(this.control_panel.get_bus());
        this._super(parent, dataset, views, flags);
        this.registry = core.view_registry.extend(x2many_views);
    },
    start: function() {
        this.control_panel.prependTo(this.$el);
        return this._super();
    },
    switch_mode: function(mode, unused) {
        if (mode !== 'form') {
            return this._super(mode, unused);
        }
        var self = this;
        var id = self.x2m.dataset.index !== null ? self.x2m.dataset.ids[self.x2m.dataset.index] : null;
        var pop = new common.FormViewDialog(this, {
            res_model: self.x2m.field.relation,
            res_id: id,
            context: self.x2m.build_context(),
            title: _t("Open: ") + self.x2m.string,
            create_function: function(data, options) {
                return self.x2m.data_create(data, options);
            },
            write_function: function(id, data, options) {
                return self.x2m.data_update(id, data, options).done(function() {
                    self.x2m.reload_current_view();
                });
            },
            alternative_form_view: self.x2m.field.views ? self.x2m.field.views.form : undefined,
            parent_view: self.x2m.view,
            child_name: self.x2m.name,
            read_function: function(ids, fields, options) {
                return self.x2m.data_read(ids, fields, options);
            },
            form_view_options: {'not_interactible_on_create':true},
            readonly: self.x2m.get("effective_readonly")
        }).open();
        pop.on("elements_selected", self, function() {
            self.x2m.reload_current_view();
        });
    },
});


var InvoicePrepareList = core.form_widget_registry.get('one2many').extend({
    init: function() {
        this._super.apply(this, arguments);
        this.x2many_views = {
            list: InvoicePrepareListView,
        };
    },

    load_views: function() {
        var self = this;

        this.views = [{
            view_id: false,
            view_type: 'list',
            fields_view: self.field.views.tree,
            options: {
                action_buttons: false,
                addable: false,
                selectable: true,
                sortable: false,
                import_enabled: false,
                deletable: false,
                reorderable: false,
                editable: true,
            },
        }];

        this.viewmanager = new X2ManyViewManager(
            this, this.dataset, this.views, this.view_options, this.x2many_views);
        this.viewmanager.x2m = self;
        var def = $.Deferred().done(function() {
            self.initial_is_loaded.resolve();
        });
        this.viewmanager.on("controller_inited", self, function(view_type, controller) {
            controller.x2m = self;
            if (self.get("effective_readonly")) {
                controller.on('edit:before', self, function (e) {
                    e.cancel = true;
                });
            }
            def.resolve();
        });
        this.viewmanager.on("switch_mode", self, function(n_mode) {
            $.when(self.commit_value()).done(function() {
                if (n_mode === "list") {
                    utils.async_when().done(function() {
                        self.reload_current_view();
                    });
                }
            });
        });
        utils.async_when().done(function () {
            self.$el.addClass('o_view_manager_content');
            self.alive(self.viewmanager.attachTo(self.$el));
        });
        return def;
    },
});


var analytic_line_arch = null;

var InvoicePrepare = common.FormWidget.extend({
    events: {
        "click .btn-generate-invoice": "generate_invoice",
    },
    init: function(){
        this._super.apply(this, arguments);
        this.set({tasks: []});
        this.task_managers = {};
        this.task_managers_list = [];
        this.task_fields = {};
        this.analytic_line_group_by = ['product_id'];
        this.field_manager.on("field_changed:all_task_ids", this, this.query_tasks);
        this.on("change:tasks", this, this.reinitialize);

        var self = this;
        this.analytic_dataset = new data.DataSet(this, 'account.analytic.line');
        this.analytic_line_fields = null;
        this.analytic_line_deferral = data_manager.load_fields(this.analytic_dataset).then(function(fields){
            self.analytic_line_fields = fields;
        });

        if(!analytic_line_arch){
            var model_data = new Model('ir.model.data');
            var view_deferral = new $.Deferred();

            // Get the tree arch used by the analytic line list
            model_data.call(
                'get_object_reference',
                ['project_invoicing', 'project_invoicing_analytic_line_tree']
            ).then(function(result) {
                data_manager.load_fields_view(
                    self.analytic_dataset, result[1], 'tree', false
                ).then(function(fields_view) {
                    analytic_line_arch = fields_view.arch;
                    view_deferral.resolve();
                });
            })

            this.analytic_line_deferral = $.when(this.analytic_line_deferral, view_deferral);
        }

        this.initialize_content();
        this.default_global_product_callback = null;
    },
    reinitialize: function() {
        this.destroy_content();
        this.renderElement();
        this.initialize_content();
    },
    initialize_content: function(){
        this.$el.html(QWeb.render("InvoicePrepare", {widget: this}));
        var data_man = require('web.data_manager');
        var self = this;
        this.analytic_line_deferral.then(function(){
            self.get('tasks').forEach(function(task){
                self.render_task(task);
            });
        });
    },
    destroy_content: function(){
        this.task_managers_list.forEach(function(manager){
            manager.destroy();
        });
        this.task_managers_list = [];
        this.task_managers = {};
        this.task_fields = {};
    },
    destroy: function(){
        this.destroy_content();
    },
    query_tasks: function() {
        this.destroy_content();
        var commands = this.field_manager.get_field_value("all_task_ids");
        var self = this;
        new Model('project.project').call(
            "resolve_2many_commands", ["all_task_ids", commands, [], new data.CompoundContext()]
        ).done(function(result) {
            self.set({tasks: result});
        });
    },
    render_task: function(task){
        /*
            Render a single task.
            Each task has its own field manager.
        */
        var field_manager = new InvoicePrepareFieldManager(this);
        this.task_managers[task.id] = field_manager;
        this.task_managers_list.push(field_manager);
        this.task_fields[task.id] = {};

        field_manager.extend_field_desc({
            global_amount: {type: 'monetary'},
            currency_id: {relation: 'res.currency', type: 'many2one'},
            partner_id: {relation: 'res.partner', type: 'many2one'},
            global_amount_product_id: {relation: 'product.product', type: 'many2one'},
            analytic_line_ids: {
                relation: 'account.analytic.line',
                views: {
                    tree: {
                        arch: analytic_line_arch,
                        fields: this.analytic_line_fields,
                    }
                },
            },
        });
        this.add_checkbox_events(task);
        this.set_invoiced_amount_label(task);
        this.add_invoiced_amount_events(task);
    },
    render_lump_sum_fields: function(task){
        if(this.task_fields[task.id].currency_id){
            return;
        }
        this.render_global_amount(task);
        this.render_currency(task);
        this.render_partner(task);
        this.render_global_amount_product(task);
    },
    get_task_el: function(task, el){
        return this.$('[data-task-id="' + task.id + '"]').find(el);
    },
    _render_field: function(task, target_class, field_attrs){
        var target = this.get_task_el(task, target_class);
        var fieldClass = core.form_widget_registry.get(field_attrs.type);
        var fieldName = field_attrs.name;
        var field = new fieldClass(this.task_managers[task.id], {
            attrs: field_attrs,
        });
        field.prependTo(target);
        this.task_fields[task.id][fieldName] = field;
        return field;
    },
    render_global_amount: function(task){
        this._render_field(task, '.field-global-amount', {
            name: "global_amount", type: "monetary"
        });
    },
    render_global_amount_product: function(task){
        var field = this._render_field(task, '.field-global-amount-product', {
            name: "global_amount_product_id", type: "many2one", modifiers: '{"required": true}'
        });
        if(!this.default_global_product_callback){
            this.default_global_product_callback = new Model('ir.values').call(
                'get_default', ['project_invoicing', 'invoicing_product_global_id'])
        }
        this.default_global_product_callback.then(function(product_id){
            field.set_value(product_id);
        });
    },
    render_currency: function(task){
        var field = this._render_field(task, '.field-currency', {
            name: "currency_id", type: "many2one", modifiers: '{"required": true}'
        });
        field.on('change', this, function(){
            this.currency_changed(task, field.get_value());
        });
        if(task.company_currency_id){
            field.set_value(task.company_currency_id[0]);
        }
    },
    render_partner: function(task){
        var field = this._render_field(task, '.field-partner', {
            name: "partner_id", type: "many2one", modifiers: '{"required": true}'
        });
        if(task.project_partner){
            field.set_value(task.project_partner[0]);
        }
    },
    currency_changed: function(task, new_currency){
        var fields = this.task_fields[task.id];
        fields.global_amount.set('currency', new_currency);
    },
    render_analytic_lines: function(task){
        var self = this;
        if(this.task_fields[task.id].analytic_line_ids){
            return;
        }
        var target = this.get_task_el(task, '.field-analytic-lines');
        var field = new InvoicePrepareList(this.task_managers[task.id], {
            attrs: {name: "analytic_line_ids", type: "one2many"},
        });
        field.prependTo(target);
        field.initial_is_loaded.done(function(){
            field.viewmanager.views.list.controller.do_search(
                [['task_id', '=', task.id], ['show_on_project_invoicing', '=', true]], {}, self.analytic_line_group_by);
        });
        this.task_fields[task.id].analytic_line_ids = field;
    },
    add_checkbox_events: function(task){
        var self = this;
        var checkbox_real = this.get_task_el(task, '.checkbox-real');
        var checkbox_lump_sum = this.get_task_el(task, '.checkbox-lump-sum');
        var lump_sum_summary = this.get_task_el(task, '.lump-sum-summary');
        var analytic_lines = this.get_task_el(task, '.field-analytic-lines');

        checkbox_real.prop('checked', false);
        checkbox_lump_sum.prop('checked', false);
        lump_sum_summary.hide();
        analytic_lines.hide();

        checkbox_real.on('click', function(){
            if(checkbox_real.prop('checked')){
                lump_sum_summary.hide();
                analytic_lines.show();
                self.render_analytic_lines(task);
                checkbox_lump_sum.prop('checked', false);
            }
            else if(!checkbox_lump_sum.prop('checked')){
                analytic_lines.hide();
            }
        });

        checkbox_lump_sum.on('click', function(){
            if(checkbox_lump_sum.prop('checked')){
                lump_sum_summary.show();
                analytic_lines.show();
                self.render_analytic_lines(task);
                self.render_lump_sum_fields(task);
                checkbox_real.prop('checked', false);
            }
            else if(!checkbox_lump_sum.prop('checked')){
                lump_sum_summary.hide();
                analytic_lines.hide();
            }
            else{
                lump_sum_summary.hide();
            }
        });
    },
    set_invoiced_amount_label: function(task){
        var currency_info = session.get_currency(task.company_currency_id[0]);
        var value = (task.invoiced_amount).toFixed(currency_info.digits[1]);
        if(currency_info.position === 'before'){
            value = currency_info.symbol + ' ' + value;
        }
        else{
            value = value + ' ' + currency_info.symbol;
        }
        var label = this.get_task_el(task, '.amount-invoiced')[0];
        label.textContent = value;
    },
    add_invoiced_amount_events: function(task){
        var self = this;
        var button = this.get_task_el(task, '.btn-amount-invoiced');
        if(task.invoice_line_ids.length){
            button.on('click', function(){
                var model_data = new Model('project.task');
                model_data.call('get_invoice_list_action', [[task.id], {}]).then(function(result) {
                    self.view.do_action(result);
                });
            })
        }
        else{
            button.prop('disabled', true);
        }
    },
    get_selected_lines: function(task){
        var fields = this.task_fields[task.id];
        var groups = fields.analytic_line_ids.viewmanager.active_view.controller.groups;
        return groups.get_selection().records;
    },
    get_task_data: function(task){
        var real = this.get_task_el(task, '.checkbox-real').prop('checked');
        var lines = this.get_selected_lines(task);
        var fields = this.task_fields[task.id];
        var res = {
            id: task.id,
            mode: real ? 'real' : 'lump_sum',
            lines: lines,
        }
        if(res.mode === 'lump_sum'){
            res.partner_id = fields.partner_id.get_value();
            res.currency_id = fields.currency_id.get_value();
            res.global_amount = fields.global_amount.get_value();
            res.global_amount_product_id = fields.global_amount_product_id.get_value();
        }
        return res;
    },
    generate_invoice: function(){
        var self = this;
        var data = {tasks: {}};

        this.get('tasks').filter(function(task){
            var real = self.get_task_el(task, '.checkbox-real').prop('checked');
            var lump_sum = self.get_task_el(task, '.checkbox-lump-sum').prop('checked');
            return real || lump_sum;
        }).forEach(function(task){
            data.tasks[task.id] = self.get_task_data(task);
        });

        var model_data = new Model('project.project');
        model_data.call(
            'generate_invoices',
            [[this.view.datarecord.id], data, {}]
        ).then(function(result) {
            self.view.do_action(result);
        });
    },
});

core.form_custom_registry.add('project_invoicing', InvoicePrepare);

return {
    InvoicePrepareGroupType,
    InvoicePrepareListType,
    InvoicePrepareListView,
    X2ManyViewManager,
    InvoicePrepareList,
    InvoicePrepare,
};

});

